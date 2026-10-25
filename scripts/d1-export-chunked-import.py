"""Preserve oversized SQL INSERT values using bounded staging updates.

Runs only on private runner files. The generated file is imported exclusively
into newly created, unbound D1 backup/restore targets by the guarded caller.
"""
import json
import os
import re
import sqlite3
import sys

source, destination = sys.argv[1:3]
limit = 60000
stage_name = '_kun_backup_restore_large_value_stage'
connection = sqlite3.connect(source + '.chunk.sqlite')
scratch = sqlite3.connect(':memory:')
rewritten = 0
largest = 0

def quoted_name(value):
    return '"' + value.replace('"', '""') + '"'

def emit(statement):
    if len(statement.encode('utf-8')) > limit:
        raise RuntimeError('CHUNKED_SQL_STATEMENT_STILL_TOO_LARGE')
    output.write(statement + '\n')

try:
    with open(source, encoding='utf-8') as stream:
        connection.executescript(stream.read())
    if connection.execute('SELECT 1 FROM sqlite_master WHERE name=?', (stage_name,)).fetchone():
        raise RuntimeError('STAGING_NAME_COLLISION')
    with open(destination, 'w', encoding='utf-8') as output:
        emit('PRAGMA defer_foreign_keys=ON;')
        for statement in connection.iterdump():
            if statement in ('BEGIN TRANSACTION;', 'COMMIT;', 'PRAGMA foreign_keys=OFF;'):
                continue
            size = len(statement.encode('utf-8'))
            largest = max(largest, size)
            if size <= limit:
                emit(statement)
                continue
            match = re.match(r'^INSERT INTO ("(?:[^"]|"")+") VALUES\(', statement)
            if not match:
                raise RuntimeError('OVERSIZED_NON_INSERT_STATEMENT')
            table = match.group(1)[1:-1].replace('""', '"')
            columns = list(connection.execute('PRAGMA table_info(' + quoted_name(table) + ')'))
            # Evaluate SQLite's own literal representation locally. Do not parse
            # customer strings or replace text inside their values.
            scratch.execute('CREATE TABLE ' + quoted_name(table) + '(' + ','.join(quoted_name('c' + str(i)) for i in range(len(columns))) + ')')
            scratch.executescript(statement)
            values = scratch.execute('SELECT * FROM ' + quoted_name(table)).fetchone()
            scratch.execute('DROP TABLE ' + quoted_name(table))
            emit('CREATE TABLE ' + quoted_name(stage_name) + '(' + ','.join(quoted_name('c' + str(i)) for i in range(len(values))) + ');')
            emit('INSERT INTO ' + quoted_name(stage_name) + ' DEFAULT VALUES;')
            for index, value in enumerate(values):
                column = quoted_name('c' + str(index))
                prefix = 'UPDATE ' + quoted_name(stage_name) + ' SET ' + column + '='
                if isinstance(value, str):
                    emit(prefix + "'';")
                    for offset in range(0, len(value), 8000):
                        literal = "'" + value[offset:offset + 8000].replace("'", "''") + "'"
                        emit(prefix + column + '||' + literal + ';')
                elif isinstance(value, bytes):
                    emit(prefix + "X'';")
                    for offset in range(0, len(value), 8000):
                        literal = "X'" + value[offset:offset + 8000].hex() + "'"
                        emit(prefix + 'CAST(' + column + '||' + literal + ' AS BLOB);')
                else:
                    literal = connection.execute('SELECT quote(?)', (value,)).fetchone()[0]
                    emit(prefix + literal + ';')
            emit('INSERT INTO ' + quoted_name(table) + ' SELECT * FROM ' + quoted_name(stage_name) + ';')
            emit('DROP TABLE ' + quoted_name(stage_name) + ';')
            rewritten += 1
    print(json.dumps({'rewrittenInsertCount': rewritten, 'largestOriginalStatementBytes': largest, 'maximumGeneratedStatementBytes': limit}))
finally:
    connection.close()
    scratch.close()
    os.remove(source + '.chunk.sqlite')
