/**
 * 语桥 ReadBridge — Edge Function: 评论提交
 * 
 * JWT验证 → Profile自动创建 → 速率限制 → 内容校验 → 写入数据库
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 30;
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "未登录" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user } } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (!user) return json(401, { error: "登录已过期" });

    const username = user.user_metadata?.username || user.email?.split("@")[0] || "匿名";

    // 确保 profile 存在（使用 maybeSingle 避免空结果抛异常）
    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!existingProfile && !profileError) {
      await supabase.from("profiles").insert({
        id: user.id,
        username: username,
        contributions: 0,
      });
    }

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
    const { error } = await supabase.from("comments").insert({
      book_id,
      paragraph_index,
      author_id: user.id,
      author_name: username,
      content: trimmed,
    });

    if (error) {
      console.error("Insert failed:", error);
      return json(500, { error: "保存失败: " + error.message });
    }
    return json(200, { success: true });

  } catch (e) {
    console.error(e);
    return json(500, { error: "服务器错误: " + (e instanceof Error ? e.message : String(e)) });
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
