-- ============================================================
-- 语桥 ReadBridge — RLS 安全回退修复脚本
-- 
-- 背景：修复外键问题时，误将 insert 策略放宽为 WITH CHECK (true)，
--      导致公开的 anon key 可以绕过 Edge Function 直接写数据库。
--      现在所有 Edge Function 已改用 service_role key（绕过 RLS），
--      因此 RLS 可以且必须恢复严格。
--
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
-- 执行顺序：先执行 ①，再执行 ②（②需要 upload-book 函数已部署）
-- ============================================================

-- ① 立即修复：封死匿名直写（anon key 无法再灌数据）
--    translations / comments / books 只允许登录用户写
--    profiles 只允许本人写自己

DROP POLICY IF EXISTS "translations_insert" ON translations;
CREATE POLICY "translations_insert" ON translations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "comments_insert" ON comments;
CREATE POLICY "comments_insert" ON comments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "books_insert" ON books;
CREATE POLICY "books_insert" ON books FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ② 最终加固（等 upload-book Edge Function 部署并验证后执行）：
--    所有写操作必须走 Edge Function（service_role），
--    客户端直写一律拒绝（WITH CHECK (false)）

-- DROP POLICY IF EXISTS "translations_insert" ON translations;
-- CREATE POLICY "translations_insert" ON translations FOR INSERT WITH CHECK (false);

-- DROP POLICY IF EXISTS "comments_insert" ON comments;
-- CREATE POLICY "comments_insert" ON comments FOR INSERT WITH CHECK (false);

-- DROP POLICY IF EXISTS "books_insert" ON books;
-- CREATE POLICY "books_insert" ON books FOR INSERT WITH CHECK (false);

-- DROP POLICY IF EXISTS "profiles_insert" ON profiles;
-- CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (false);

-- DROP POLICY IF EXISTS "translations_update" ON translations;
-- CREATE POLICY "translations_update" ON translations FOR UPDATE WITH CHECK (false);

-- DROP POLICY IF EXISTS "profiles_update" ON profiles;
-- CREATE POLICY "profiles_update" ON profiles FOR UPDATE WITH CHECK (false);
