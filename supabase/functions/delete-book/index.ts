/**
 * 语桥 ReadBridge — Edge Function: 删除书籍
 * 
 * 权限：仅上传者可删除自己的书
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

    const body = await req.json();
    const { book_id } = body;

    if (!book_id) return json(400, { error: "缺少 book_id" });

    // 验证所有权
    const { data: book } = await supabase
      .from("books")
      .select("uploader_id, title")
      .eq("id", book_id)
      .maybeSingle();

    if (!book) return json(404, { error: "书籍不存在" });
    if (book.uploader_id !== user.id) return json(403, { error: "无权限：只能删除自己上传的书" });

    // 级联删除
    const { error: e1 } = await supabase.from("translation_votes").delete().eq("translation_id", book_id);
    const { error: e2 } = await supabase.from("comments").delete().eq("book_id", book_id);
    const { error: e3 } = await supabase.from("translations").delete().eq("book_id", book_id);
    const { error: e4 } = await supabase.from("books").delete().eq("id", book_id);

    if (e4) {
      console.error("Delete failed:", e4);
      return json(500, { error: "删除失败: " + e4.message });
    }

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
