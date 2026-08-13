/**
 * 语桥 ReadBridge — 公共共享层
 * 
 * 所有 Edge Function 共用：CORS 处理、JWT 验证、JSON 响应。
 * 修改一处，全部函数生效。
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** CORS 预检响应 */
export function corsResponse() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

/** 统一 JSON 响应（自动带 CORS 头） */
export function json(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
    },
  });
}

/** 创建服务端客户端（service_role，绕过 RLS） */
export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

/** 从请求头提取 Bearer token */
export function getToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.replace("Bearer ", "");
}

/** 验证 JWT 并返回用户（失败返回 null） */
export async function getUser(supabase: any, token: string) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

/** 从 JWT 元数据提取显示名 */
export function getUsername(user: any): string {
  return user?.user_metadata?.username || user?.email?.split("@")[0] || "匿名";
}

/** 确保 profile 存在（自动创建） */
export async function ensureProfile(supabase: any, user: any) {
  const username = getUsername(user);
  const { data: existing, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing && !error) {
    await supabase.from("profiles").insert({
      id: user.id,
      username,
      contributions: 0,
    });
  }
}
