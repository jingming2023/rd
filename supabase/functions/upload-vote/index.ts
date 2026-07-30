/**
 * 语桥 ReadBridge — Edge Function: 翻译投票
 * 
 * 赞(1)/踩(-1)/取消(再次点击同方向)
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
    const { translation_id, vote } = body;

    if (!translation_id || ![1, -1].includes(vote)) {
      return json(400, { error: "参数无效" });
    }

    // 检查是否已投过同方向 → 取消
    const { data: existing } = await supabase
      .from("translation_votes")
      .select("id, vote")
      .eq("translation_id", translation_id)
      .eq("voter_id", user.id)
      .maybeSingle();

    if (existing && existing.vote === vote) {
      // 同方向再次点击 → 取消投票
      await supabase
        .from("translation_votes")
        .delete()
        .eq("id", existing.id);
      return json(200, { success: true, action: "cancelled" });
    }

    // 新投票或改方向
    const { error } = await supabase
      .from("translation_votes")
      .upsert(
        { translation_id, voter_id: user.id, vote },
        { onConflict: "translation_id,voter_id" }
      );

    if (error) {
      console.error("Vote failed:", error);
      return json(500, { error: "投票失败: " + error.message });
    }

    return json(200, { success: true, action: "voted" });

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
