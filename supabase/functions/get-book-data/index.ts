/**
 * 语桥 ReadBridge — Edge Function: 按章获取书籍数据（服务端分页）
 * 
 * 解决：打开大书全量拉取 19K 段的问题。
 * 只返回请求范围内的段落 + 翻译版本 + 评论。
 * 响应带 Cache-Control: public, max-age=300（5分钟缓存）。
 * 
 * 用法：
 *   GET /functions/v1/get-book-data?book_id=X&lang=en&start=0&end=100
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsResponse, json, adminClient } from "../_shared/mod.ts";

const MAX_RANGE = 300;  // 单次最多 300 段

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") return json(405, { error: "仅支持 GET" });

  try {
    const url = new URL(req.url);
    const book_id = url.searchParams.get("book_id");
    const lang = url.searchParams.get("lang") || "zh";
    const start = parseInt(url.searchParams.get("start") || "0");
    const end = parseInt(url.searchParams.get("end") || "100");

    if (!book_id) return json(400, { error: "缺少 book_id" });
    if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
      return json(400, { error: "范围参数无效" });
    }
    const safeEnd = Math.min(end, start + MAX_RANGE);

    const supabase = adminClient();

    // 1. 段落（原文或译文）
    const { data: paras, error: pErr } = await supabase
      .from("translations")
      .select("paragraph_index, content, version, author_name")
      .eq("book_id", book_id)
      .eq("language", lang)
      .gte("paragraph_index", start)
      .lt("paragraph_index", safeEnd)
      .order("paragraph_index", { ascending: true });

    if (pErr) return json(500, { error: "段落查询失败" });

    // 2. 评论（该范围）
    const { data: comments, error: cErr } = await supabase
      .from("comments")
      .select("paragraph_index, author_name, content, created_at")
      .eq("book_id", book_id)
      .gte("paragraph_index", start)
      .lt("paragraph_index", safeEnd)
      .order("created_at", { ascending: true });

    if (cErr) return json(500, { error: "评论查询失败" });

    return json(200, {
      book_id,
      language: lang,
      start,
      end: safeEnd,
      paras: paras || [],
      comments: comments || [],
    });

  } catch (e) {
    console.error("get-book-data error:", e);
    return json(500, { error: "服务器内部错误" });
  }
});
