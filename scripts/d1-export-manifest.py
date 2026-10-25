"""Inspect a private D1 SQL export without printing any row values."""
import hashlib
import json
import os
import sqlite3
import sys

path = sys.argv[1]
connection = sqlite3.connect(path + '.sqlite')
try:
    with open(path, encoding='utf-8') as stream:
        sql = stream.read()
    connection.executescript(sql)
    integrity = connection.execute('PRAGMA integrity_check').fetchone()[0]
    names = sorted(row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'"
    ))
    counts = {}
    content = hashlib.sha256()
    for name in names:
        rows = connection.execute('SELECT * FROM "' + name.replace('"', '""') + '"')
        hashes = sorted(hashlib.sha256(json.dumps(
            list(row), ensure_ascii=False, separators=(',', ':'),
            default=lambda value: {'bytes': value.hex()}
        ).encode()).hexdigest() for row in rows)
        counts[name] = len(hashes)
        content.update(name.encode() + b'\0' + ''.join(hashes).encode() + b'\0')
    print(json.dumps({
        'manifest': counts,
        'dumpSha256': hashlib.sha256(sql.encode()).hexdigest(),
        'contentFingerprint': content.hexdigest(),
        'integrity': integrity,
    }))
finally:
    connection.close()
    os.remove(path + '.sqlite')
