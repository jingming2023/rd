#!/usr/bin/env python3
"""
语桥 ReadBridge — 段落不可变 ID 迁移脚本
========================================
将现有 (book_id, paragraph_index) 数据迁移到段落哈希体系：
1. 为每本书的 zh 段落生成 paragraphs 记录（content_hash 为身份）
2. 更新 translations.paragraph_id（按 book_id+paragraph_index 匹配）

用法：
    set SUPABASE_URL=https://hgdmyrkdxcnduxhbezfd.supabase.co
    set SUPABASE_SERVICE_KEY=你的secret key（仅本机）
    python tools/migrate-paragraphs.py

安全：幂等可重复执行；执行前请先备份（Supabase Dashboard → Database → Backups）
"""

import os, sys, json, hashlib, time
from urllib import request

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://hgdmyrkdxcnduxhbezfd.supabase.co")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def api(method, path, body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode() if body else None
    req = request.Request(url, data=data, method=method, headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    })
    with request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode() or "null")


def fetch_all(path):
    rows, offset = [], 0
    while True:
        sep = "&" if "?" in path else "?"
        url = f"{path}{sep}limit=1000&offset={offset}"
        req = request.Request(f"{SUPABASE_URL}/rest/v1/{url}", headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
        })
        with request.urlopen(req, timeout=60) as resp:
            batch = json.loads(resp.read().decode())
        if not batch:
            break
        rows.extend(batch)
        offset += 1000
        if len(batch) < 1000:
            break
    return rows


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main():
    if not SERVICE_KEY:
        print("❌ 请设置 SUPABASE_SERVICE_KEY 环境变量")
        sys.exit(1)

    print("⚠️  执行前请确认已在 Supabase 执行建表 SQL（docs/PARAGRAPH-MIGRATION.md Step1）")
    confirm = input("确认已建表？(yes/no): ")
    if confirm.strip().lower() != "yes":
        print("已取消")
        sys.exit(0)

    print("\n📥 读取 zh 段落...")
    zh_rows = fetch_all("translations?select=id,book_id,paragraph_index,content&language=eq.zh")
    print(f"   共 {len(zh_rows)} 条 zh 段落")

    # 按书分组、按段落号排序
    books = {}
    for r in zh_rows:
        books.setdefault(r["book_id"], []).append(r)
    for b in books.values():
        b.sort(key=lambda x: x["paragraph_index"])

    print("\n📦 生成段落记录...")
    total = 0
    for book_id, rows in books.items():
        for r in rows:
            h = sha256(r["content"])
            # upsert paragraphs
            existing = api("GET", f"paragraphs?select=id&book_id=eq.{book_id}&content_hash=eq.{h}")
            if existing:
                pid = existing[0]["id"]
            else:
                ins = api("POST", "paragraphs", {
                    "book_id": book_id,
                    "position": r["paragraph_index"],
                    "content_hash": h,
                    "content": r["content"],
                })
                pid = ins[0]["id"]
            # 关联 translations（幂等）
            api("PATCH", f"translations?id=eq.{r['id']}", {"paragraph_id": pid})
            total += 1
        print(f"   📖 {book_id}: {len(rows)} 段")

    print(f"\n✅ 迁移完成：{total} 条段落已生成 paragraph_id")
    print("📋 下一步：执行验证 SQL（见 docs/PARAGRAPH-MIGRATION.md Step3）")


if __name__ == "__main__":
    main()
