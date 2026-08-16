#!/usr/bin/env python3
"""
ad-spend-sync.py
-----------------
بيشغّل meta_ads_spend.py بتاعك ويرفع النتيجة على نظام كن أونلاين،
وكمان بيجيب الرصيد المتبقي في كل حساب إعلانات مباشرة من ميتا (حسابات الدفع المقدّم في مصر).
مصمم يشتغل من OpenClaw كمهمة يومية، أو تجربه بإيدك من الطرفية.

الاستخدام:
    python3 ad-spend-sync.py                  # مصروف النهاردة
    python3 ad-spend-sync.py 2026-08-09        # يوم معيّن

محتاج ملف ~/konline/.env فيه:
    KONLINE_URL=https://app.kun-online.com
    INGEST_TOKEN=...
    META_ACCESS_TOKEN=...   (نفس المفتاح اللي meta_ads_spend.py بيستخدمه)
"""

import os
import sys
import json
import subprocess
import urllib.request
import urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)) or "/root/.openclaw/workspace"
META_SCRIPT_PATHS = [
    os.path.join(SCRIPT_DIR, "meta_ads_spend.py"),
    "/root/.openclaw/workspace/meta_ads_spend.py",
]
ENV_FILE = os.path.expanduser("~/konline/.env")


def load_env():
    """بيحمّل .env من غير ما يكتب فوق متغيرات موجودة أصلاً في البيئة"""
    if not os.path.exists(ENV_FILE):
        return
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def find_meta_script():
    for p in META_SCRIPT_PATHS:
        if os.path.exists(p):
            return p
    return None


def load_ad_accounts(meta_script_path):
    """بنستورد قاموس الحسابات من سكريبتك نفسه — عشان ما نكررش نفس البيانات
    في مكانين، ولو ضفت حساب جديد هناك يظهر هنا أوتوماتيك"""
    import importlib.util
    spec = importlib.util.spec_from_file_location("meta_ads_spend", meta_script_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.AD_ACCOUNTS


def api(path, method="GET", body=None, token=None, base=None):
    url = (base or os.environ["KONLINE_URL"]).rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            raise RuntimeError(f"HTTP {e.code} من النظام")


def fetch_balance(account_id):
    """بيرجع الرصيد المتبقي (بالقروش/السنتات) من ميتا مباشرة، أو None لو فشل"""
    url = (
        f"https://graph.facebook.com/v21.0/{account_id}"
        f"?fields=balance,currency&access_token={os.environ['META_ACCESS_TOKEN']}"
    )
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.loads(r.read().decode())
        if "balance" not in data:
            return None
        return {"amount": round(int(data["balance"]) / 100, 2), "currency": data.get("currency", "")}
    except Exception:
        return None


def fail(msg, **extra):
    print(json.dumps({"error": msg, **extra}, ensure_ascii=False))
    sys.exit(1)


def main():
    load_env()
    for k in ("KONLINE_URL", "INGEST_TOKEN", "META_ACCESS_TOKEN"):
        if not os.environ.get(k):
            fail(f"{k} ناقص من {ENV_FILE}")

    meta_script = find_meta_script()
    if not meta_script:
        fail("ملقيناش meta_ads_spend.py — تأكد من المسار في META_SCRIPT_PATHS")

    try:
        ad_accounts = load_ad_accounts(meta_script)
    except Exception as e:
        fail(f"ما قدرناش نقرا الحسابات من meta_ads_spend.py: {e}")

    date_arg = sys.argv[1] if len(sys.argv) > 1 else None
    cmd = [sys.executable, meta_script, "--account", "all", "--json"]
    cmd += ["--since", date_arg, "--until", date_arg] if date_arg else ["--date_preset", "today"]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=os.environ.copy())
    except subprocess.TimeoutExpired:
        fail("meta_ads_spend.py ماردّش خلال ٦٠ ثانية")

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        fail("ناتج meta_ads_spend.py مش JSON صالح", raw=proc.stdout[:500], stderr=proc.stderr[:500])

    entries, problems = [], []
    for key, row in data.items():
        acct_id = ad_accounts.get(key, {}).get("id")
        label = row.get("label", key)
        if not acct_id:
            problems.append(f"{label}: ملقيناش account id في القاموس")
            continue
        if "error" in row:
            problems.append(f"{label}: {row['error']}")
            continue
        try:
            spend = float(row.get("spend", "0") or "0")
        except (TypeError, ValueError):
            spend = 0.0
        entries.append({"adAccount": acct_id, "spend": spend})

    for e in entries:
        bal = fetch_balance(e["adAccount"])
        if bal:
            e["balance"] = bal["amount"]
            e["balanceCurrency"] = bal["currency"]

    if not entries:
        fail("مفيش بيانات نرفعها", problems=problems)

    payload = {"entries": entries}
    if date_arg:
        payload["date"] = date_arg

    try:
        result = api("/api/ad-spend", "POST", payload, os.environ["INGEST_TOKEN"])
    except Exception as e:
        fail(f"فشل الاتصال بنظام كن أونلاين: {e}")

    if not result.get("ok"):
        fail("النظام رفض التسجيل", detail=result)

    total = sum(e["spend"] for e in entries)
    day = result.get("date", "اليوم")
    summary = f"مصروف إعلانات {day}: {total:.2f} — اتسجّل {len(result['applied'])} حساب"
    if result.get("skipped"):
        skipped_names = [s.get("client", s.get("why", "")) for s in result["skipped"]]
        summary += f" · اتخطى {len(result['skipped'])} ({', '.join(skipped_names)})"
    if problems:
        summary += "\nمشاكل: " + " | ".join(problems)

    print(summary)


if __name__ == "__main__":
    main()
