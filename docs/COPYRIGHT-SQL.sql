-- ============================================================
-- 语桥 ReadBridge — 版权合规落地脚本（公版优先）
-- 执行位置：Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. books 表加 license 字段
ALTER TABLE books ADD COLUMN IF NOT EXISTS license TEXT DEFAULT 'pending';

-- 2. 用户上传的书籍默认视为待审核（pending）
--    上传协议要求用户声明拥有授权，管理员审核后改为 public_domain / open

-- 3. 预置书的版权标注（代码端已处理，这里仅数据库侧）
--    little-prince  → public_domain（作者1944年去世，中国版权法+50年已公版）
--    border-town    → pending（沈从文1988年去世，中国版权法+50年=2038年到期）
--    doupo/quanzhi  → pending（在世作者，商业版权）
--    neural-net/climate-change → open（科普中国开放内容）

-- 4. 索引：加速按版权状态过滤
CREATE INDEX IF NOT EXISTS idx_books_license ON books(license);

-- 5. 可选：清理历史遗留的 pending 书籍可见性
--    （前端已按 license != 'pending' 过滤，此索引供 SQL 管理用）
