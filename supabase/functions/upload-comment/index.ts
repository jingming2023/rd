/**
 * 语桥 ReadBridge — Edge Function: 评论提交
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 30;  // 每分钟30条评论
const COMMENT_MAX = 1000;

serve(async (req: Request) => {
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
    return json(405, { error: "仅支持 POST" });
  }

  try {
    // 验证 JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "未登录" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { data: { user } } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (!user) return json(401, { error: "登录已过期" });

    // 速率限制
    const windowStart = new Date(Date.now() - 60000).toISOString();
    const { count } = await supabase
      .from("comments")
      .select("*", { count: "exact", head: true })
      .eq("author_id", user.id)
      .gte("created_at", windowStart);
    if (count && count >= RATE_LIMIT_MAX) {
      return json(429, { error: "评论太频繁，请稍后再试" });
    }

    // 解析 + 校验
    const body = await req.json();
    const { book_id, paragraph_index, content } = body;

    if (!book_id || paragraph_index === undefined || !content?.trim()) {
      return json(400, { error: "参数不完整" });
    }
    const trimmed = content.trim();
    if (trimmed.length > COMMENT_MAX) {
      return json(400, { error: `评论过长（最多${COMMENT_MAX}字符）` });
    }

    // 写入
    const username = user.user_metadata?.username || user.email?.split("@")[0] || "匿名";
    const { error } = await supabase.from("comments").insert({
      book_id,
      paragraph_index,
      author_id: user.id,
      author_name: username,
      content: trimmed,
    });

    if (error) return json(500, { error: "保存失败" });
    return json(200, { success: true });

  } catch (e) {
    console.error(e);
    return json(500, { error: "服务器错误" });
  }
});

function json(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
