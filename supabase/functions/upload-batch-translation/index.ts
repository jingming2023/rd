/**
 * 语桥 ReadBridge — Edge Function: 批量翻译上传
 * 
 * 用于 doTransUp() 全书翻译上传。高吞吐量（最高500段/次）。
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_BATCH = 500;
const MAX_PER_MINUTE = 5;  // 每人每分钟最多5次批量请求

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

    // 速率限制（批量操作限制更严）
    const windowStart = new Date(Date.now() - 60000).toISOString();
    const { count } = await supabase
      .from("translations")
      .select("*", { count: "exact", head: true })
      .eq("author_id", user.id)
      .gte("created_at", windowStart);

    if (count && count >= 2000) {
      return json(429, { error: "操作太频繁，每分钟最多批量上传2000段" });
    }

    const body = await req.json();
    const { book_id, language, items } = body;

    if (!book_id || !language || !Array.isArray(items) || items.length === 0) {
      return json(400, { error: "参数不完整" });
    }
    if (items.length > MAX_BATCH) {
      return json(400, { error: `单次最多${MAX_BATCH}段，当前${items.length}段` });
    }
    if (!["en", "ja", "ko", "fr"].includes(language)) {
      return json(400, { error: "不支持的语言" });
    }

    // 验证每个item
    const username = user.user_metadata?.username || user.email?.split("@")[0] || "匿名";
    const rows = [];
    for (const item of items) {
      if (typeof item.paragraph_index !== "number" || item.paragraph_index < 0) continue;
      const content = String(item.content || "").trim();
      if (content.length < 2 || content.length > 5000) continue;
      rows.push({
        book_id,
        paragraph_index: item.paragraph_index,
        language,
        version: 1,
        author_id: user.id,
        author_name: username,
        content,
      });
    }

    if (rows.length === 0) {
      return json(400, { error: "没有有效的翻译数据" });
    }

    // 批量插入（100条/批次，避免单次请求过大）
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase.from("translations").insert(batch);
      if (error) {
        console.error(`Batch ${i} failed:`, error);
        return json(500, { error: `第${i + 1}段附近写入失败: ` + error.message });
      }
      inserted += batch.length;
    }

    return json(200, { success: true, inserted });

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
