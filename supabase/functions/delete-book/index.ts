/**
 * 语桥 ReadBridge — Edge Function: 删除书籍
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { book_id } = await req.json();
    if (!book_id) return json(400, { error: "缺少 book_id" });

    // 验证所有权
    const { data: book } = await supabase
      .from("books")
      .select("uploader_id")
      .eq("id", book_id)
      .maybeSingle();

    if (!book) return json(404, { error: "书籍不存在" });
    if (book.uploader_id !== user.id) return json(403, { error: "无权限" });

    // 级联删除：评论 → 翻译 → 书籍
    await supabase.from("comments").delete().eq("book_id", book_id);
    await supabase.from("translations").delete().eq("book_id", book_id);
    const { error } = await supabase.from("books").delete().eq("id", book_id);

    if (error) return json(500, { error: "删除失败: " + error.message });
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
