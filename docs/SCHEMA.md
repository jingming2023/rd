# 语桥 ReadBridge — 数据库 Schema 参考

> Supabase 项目: hgdmyrkdxcnduxhbezfd  
> 数据库: PostgreSQL (Supabase 免费层)

## RLS 策略 (必须手动在 Supabase Dashboard 执行)

> ⚠️ **重要：** 2026-07 修复外键问题时，数据库中的 insert 策略曾被临时放宽为 `WITH CHECK (true)`（文档未同步）。
> **当前数据库状态与下面文档不一致**，请执行 `docs/RLS-FIX.sql` 中的 ① 恢复严格策略。
> 所有 Edge Function 已使用 service_role key（绕过 RLS），收紧 RLS 不影响网关功能。

```sql
-- 1. 启用所有表的RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_votes ENABLE ROW LEVEL SECURITY;

-- 2. profiles — 任何人能读，只有本人能修改
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- 3. books — 任何人能读，登录用户能新增，仅上传者可删除
CREATE POLICY "books_select" ON books FOR SELECT USING (true);
CREATE POLICY "books_insert" ON books FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "books_delete" ON books FOR DELETE USING (auth.uid() = uploader_id);

-- 4. translations — 任何人能读，登录用户能增删（仅作者可删）
CREATE POLICY "translations_select" ON translations FOR SELECT USING (true);
CREATE POLICY "translations_insert" ON translations FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "translations_delete" ON translations FOR DELETE USING (auth.uid() = author_id);

-- 5. comments — 同上
CREATE POLICY "comments_select" ON comments FOR SELECT USING (true);
CREATE POLICY "comments_insert" ON comments FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "comments_delete" ON comments FOR DELETE USING (auth.uid() = author_id);

-- 6. translation_votes
CREATE POLICY "votes_select" ON translation_votes FOR SELECT USING (true);
CREATE POLICY "votes_insert" ON translation_votes FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "votes_delete" ON translation_votes FOR DELETE USING (auth.uid() = voter_id);
```

## 索引

```sql
CREATE INDEX IF NOT EXISTS idx_translations_book_lang_para
  ON translations(book_id, language, paragraph_index);
CREATE INDEX IF NOT EXISTS idx_translations_author ON translations(author_id);
CREATE INDEX IF NOT EXISTS idx_comments_book ON comments(book_id, paragraph_index);
CREATE INDEX IF NOT EXISTS idx_books_uploader ON books(uploader_id);
CREATE INDEX IF NOT EXISTS idx_votes_translation ON translation_votes(translation_id);
```

## 表结构

### books
| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 书籍ID（如 'little-prince', 'u-1234567890-xxxx'） |
| title | TEXT | 书名 |
| author | TEXT | 作者 |
| genre | TEXT | 分类（名著/网文/科普/其他） |
| cover | TEXT | 封面emoji |
| description | TEXT | 简介 |
| word_count | INTEGER | 字数 |
| uploader_id | UUID FK→profiles.id | 上传者（NULL=预置书） |
| created_at | TIMESTAMP | 创建时间 |

### translations
| 列 | 类型 | 说明 |
|----|------|------|
| id | BIGSERIAL PK | 自增ID |
| book_id | TEXT FK→books.id | 所属书籍 |
| paragraph_index | INTEGER | 段落下标（0-based，脆弱！） |
| language | TEXT | 语言代码（en/ja/ko/fr） |
| version | INTEGER | 版本号（1=AI初稿，2+=人工改进） |
| author_id | UUID FK→profiles.id | 作者 |
| author_name | TEXT | 作者显示名 |
| content | TEXT | 翻译内容 |
| created_at | TIMESTAMP | 创建时间 |

### comments
| 列 | 类型 | 说明 |
|----|------|------|
| id | BIGSERIAL PK | 自增ID |
| book_id | TEXT FK→books.id | 所属书籍 |
| paragraph_index | INTEGER | 段落下标 |
| author_id | UUID FK→profiles.id | 评论者 |
| author_name | TEXT | 评论者显示名 |
| content | TEXT | 评论内容 |
| created_at | TIMESTAMP | 创建时间 |

### profiles
| 列 | 类型 | 说明 |
|----|------|------|
| id | UUID PK | 关联 auth.users.id |
| username | TEXT | 用户名 |
| bio | TEXT | 个人简介 |
| contributions | INTEGER | 翻译贡献数 |
| languages | TEXT | JSON数组，擅长语言 |
| badges | TEXT | JSON数组，徽章 |
| upvotes_received | INTEGER | 收到的赞数 |

### translation_votes
| 列 | 类型 | 说明 |
|----|------|------|
| id | BIGSERIAL PK | 自增ID |
| translation_id | BIGINT FK→translations.id | 被投票的翻译 |
| voter_id | UUID FK→profiles.id | 投票者 |
| vote | INTEGER | 1=赞, -1=踩 |
| created_at | TIMESTAMP | 创建时间 |
| UNIQUE | (translation_id, voter_id) | 每人每段只能投一次 |

---

## 演示账号

所有密码: `demo1234`

| 邮箱 | 用户名 |
|------|--------|
| alice@demo.com | Alice |
| bob@demo.com | Bob |
| carol@demo.com | Carol |
| david@demo.com | David |
| emma@demo.com | Emma |
| frank@demo.com | Frank |
