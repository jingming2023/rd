/**
 * 语桥 ReadBridge — Edge Function: 上传新书
 * 
 * 将 doUp() 的直写操作迁移到 API 网关：
 * 1. 创建 books 记录
 * 2. 批量写入中文段落到 translations (language='zh')
 * 3. 写入后验证
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_PARAS = 5000;        // 单本书最多段落数
const MAX_CHARS = 5_000_000;   // 单本书最大字符数（5M）
const BATCH_SIZE = 100;

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

    const body = await req.json();
    const { book_id, title, author, genre, paragraphs } = body;

    // === 参数校验 ===
    if (!book_id || !title) return json(400, { error: "缺少书名或书ID" });
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return json(400, { error: "没有段落内容" });
    }
    if (paragraphs.length > MAX_PARAS) {
      return json(400, { error: `段落数超过上限（${MAX_PARAS}）` });
    }
    const totalChars = paragraphs.reduce((s: number, p: string) => s + String(p).length, 0);
    if (totalChars > MAX_CHARS) {
      return json(400, { error: "内容过长（超过5MB字符）" });
    }

    // === 清理段落 ===
    const cleanParas = paragraphs
      .map((p: unknown) => String(p || "").trim())
      .filter((p: string) => p.length > 0);
    if (cleanParas.length === 0) return json(400, { error: "没有有效段落" });

    // === 创建书籍记录 ===
    const username = user.user_metadata?.username || user.email?.split("@")[0] || "匿名";
    const { error: bookError } = await supabase.from("books").insert({
      id: book_id,
      title: title.trim(),
      author: String(author || "佚名").trim(),
      genre: String(genre || "其他"),
      cover: "📖",
      description: cleanParas.join("\n").substring(0, 5000),
      word_count: totalChars,
      uploader_id: user.id,
    });

    if (bookError) {
      // 可能是重复ID，重试失败直接报错
      console.error("Book insert failed:", bookError);
      return json(500, { error: "创建书籍失败: " + bookError.message });
    }

    // === 批量写入段落 (language='zh') ===
    let inserted = 0;
    for (let i = 0; i < cleanParas.length; i += BATCH_SIZE) {
      const batch = cleanParas.slice(i, i + BATCH_SIZE).map((p: string, j: number) => ({
        book_id,
        paragraph_index: i + j,
        language: "zh",
        version: 1,
        author_id: user.id,
        author_name: username,
        content: p,
      }));
      const { error: insError } = await supabase.from("translations").insert(batch);
      if (insError) {
        console.error(`Batch ${i} failed:`, insError);
        // 清理已创建的书籍（避免半成品）
        await supabase.from("books").delete().eq("id", book_id);
        return json(500, { error: `段落写入失败（第${i + 1}段）: ` + insError.message });
      }
      inserted += batch.length;
    }

    return json(200, { success: true, book_id, inserted });

  } catch (e) {
    console.error("Unexpected error:", e);
    return json(500, { error: "服务器内部错误" });
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
