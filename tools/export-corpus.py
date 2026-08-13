#!/usr/bin/env python3
"""
语桥 ReadBridge — 语料导出脚本（数据飞轮地基）
====================================================
把 translations 表中"AI初译 + 人工修正"的对照导出为 JSONL，
这是未来训练纠错模型/翻译质量评估的核心数据资产。

用法：
    set SUPABASE_URL=https://hgdmyrkdxcnduxhbezfd.supabase.co
    set SUPABASE_SERVICE_KEY=你的secret key（仅本机使用）
    python tools/export-corpus.py --output corpus.jsonl --limit 1000

输出格式（每行一个JSON）：
    {
      "book_id": "little-prince",
      "paragraph_index": 3,
      "zh": "原文段落...",
      "ai_v1": "AI初稿译文...",
      "human_v2": "人工修正译文...",
      "language": "en"
    }

说明：
- 只导出 v1=AI 且 v2=人工 的段落（有修正信号的数据）
- diff_type 由人工/脚本后续标注（漏译/错译/风格优化/术语修正）
"""

import os, sys, json, hashlib, argparse
from urllib import request

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://hgdmyrkdxcnduxhbezfd.supabase.co")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def fetch_all(table, params):
    """分页拉取全部数据"""
    rows, offset = [], 0
    while True:
        url = f"{SUPABASE_URL}/rest/v1/{table}?{params}&limit=1000&offset={offset}"
        req = request.Request(url, headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
        })
        with request.urlopen(req, timeout=30) as resp:
            batch = json.loads(resp.read().decode("utf-8"))
        if not batch:
            break
        rows.extend(batch)
        offset += 1000
        if len(batch) < 1000:
            break
    return rows


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main():
    if not SERVICE_KEY:
        print("❌ 请设置环境变量 SUPABASE_SERVICE_KEY（仅本机使用，不要提交）")
        sys.exit(1)

    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="corpus.jsonl", help="输出文件")
    parser.add_argument("--limit", type=int, default=0, help="最多导出条数（0=全部）")
    args = parser.parse_args()

    print("📥 拉取中文原文段落...")
    zh_rows = fetch_all("translations", "select=*&book_id=neq.u-&language=eq.zh")
    print(f"   原文段落: {len(zh_rows)} 条")

    print("📥 拉取英文翻译版本...")
    en_rows = fetch_all("translations", "select=*&language=eq.en&order=paragraph_index.asc")
    print(f"   翻译版本: {len(en_rows)} 条")

    # 按 (book_id, paragraph_index) 分组
    from collections import defaultdict
    en_by_para = defaultdict(list)
    for r in en_rows:
        en_by_para[(r["book_id"], r["paragraph_index"])].append(r)

    zh_by_para = {}
    for r in zh_rows:
        zh_by_para[(r["book_id"], r["paragraph_index"])] = r["content"]

    # 组装对照数据
    corpus = []
    for (book_id, pi), versions in en_by_para.items():
        if book_id not in zh_by_para:
            continue
        zh_text = zh_by_para[(book_id, pi)]
        versions.sort(key=lambda v: v.get("version", 1))

        ai_v1 = None
        human_v2 = None
        for v in versions:
            author = v.get("author_name", "")
            if author in ("AI", "ai", "") and ai_v1 is None:
                ai_v1 = v["content"]
            elif author not in ("AI", "ai", ""):
                human_v2 = v["content"]

        if ai_v1 and human_v2 and ai_v1 != human_v2:
            corpus.append({
                "book_id": book_id,
                "paragraph_index": pi,
                "zh": zh_text,
                "zh_hash": sha256(zh_text),
                "ai_v1": ai_v1,
                "human_v2": human_v2,
                "language": "en",
            })

    if args.limit:
        corpus = corpus[:args.limit]

    with open(args.output, "w", encoding="utf-8") as f:
        for item in corpus:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    print(f"\n✅ 导出完成: {len(corpus)} 条 AI+人工修正对照")
    print(f"📂 输出文件: {args.output}")
    print(f"💡 这是数据飞轮的地基——后续 AI 审校/记忆库/模型微调都靠它")


if __name__ == "__main__":
    main()
