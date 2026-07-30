/**
 * 语桥 ReadBridge — Edge Function: 翻译提交
 * 
 * 替代前端直接操作数据库的安全API层。
 * 功能：JWT验证 → 速率限制 → 内容校验 → 写入数据库
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_WINDOW = 60;        // 窗口：60秒
const RATE_LIMIT_MAX = 20;           // 每窗口最多20次
const CONTENT_MIN_LENGTH = 2;        // 最短翻译：2字符
const CONTENT_MAX_LENGTH = 5000;     // 最长翻译：5000字符

serve(async (req: Request) => {
  // === CORS 预检 ===
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "仅支持 POST 请求" });
  }

  try {
    // === 1. 验证 JWT ===
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "未登录" });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse(401, { error: "登录已过期，请重新登录" });
    }

    // === 2. 速率限制 ===
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from("translations")
      .select("*", { count: "exact", head: true })
      .eq("author_id", user.id)
      .gte("created_at", windowStart);

    if (!countError && count !== null && count >= RATE_LIMIT_MAX) {
      return jsonResponse(429, {
        error: `操作太频繁，每分钟最多${RATE_LIMIT_MAX}次，请稍后再试`,
      });
    }

    // === 3. 解析请求体 ===
    const body = await req.json();
    const { book_id, paragraph_index, language, content } = body;

    // === 4. 参数校验 ===
    if (!book_id || paragraph_index === undefined || !language || !content) {
      return jsonResponse(400, { error: "缺少必填参数" });
    }
    if (typeof paragraph_index !== "number" || paragraph_index < 0) {
      return jsonResponse(400, { error: "段落编号无效" });
    }
    if (!["en", "ja", "ko", "fr"].includes(language)) {
      return jsonResponse(400, { error: "不支持的语言" });
    }
    const trimmedContent = content.trim();
    if (trimmedContent.length < CONTENT_MIN_LENGTH) {
      return jsonResponse(400, { error: `翻译内容过短（最少${CONTENT_MIN_LENGTH}字符）` });
    }
    if (trimmedContent.length > CONTENT_MAX_LENGTH) {
      return jsonResponse(400, { error: `翻译内容过长（最多${CONTENT_MAX_LENGTH}字符）` });
    }

    // === 5. 获取当前版本号 ===
    const { data: existing } = await supabase
      .from("translations")
      .select("version")
      .eq("book_id", book_id)
      .eq("paragraph_index", paragraph_index)
      .eq("language", language)
      .order("version", { ascending: false })
      .limit(1);

    const nextVersion = (existing && existing.length > 0) ? existing[0].version + 1 : 1;

    // === 6. 写入数据库 ===
    const username = user.user_metadata?.username || user.email?.split("@")[0] || "匿名";
    const { error: insertError } = await supabase
      .from("translations")
      .insert({
        book_id,
        paragraph_index,
        language,
        version: nextVersion,
        author_id: user.id,
        author_name: username,
        content: trimmedContent,
      });

    if (insertError) {
      console.error("Insert failed:", insertError);
      return jsonResponse(500, { error: "保存失败，请稍后重试" });
    }

    return jsonResponse(200, {
      success: true,
      version: nextVersion,
      author_name: username,
    });

  } catch (e) {
    console.error("Unexpected error:", e);
    return jsonResponse(500, { error: "服务器内部错误" });
  }
});

function jsonResponse(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
