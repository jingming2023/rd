# 语桥 ReadBridge — A2 段落不可变 ID 迁移方案

> 状态：设计文档（2026-07）
> 目标：修复 `paragraph_index`（数组下标）绑定导致的翻译错位问题

---

## 一、问题定义

当前所有翻译通过 `(book_id, paragraph_index)` 定位段落：
- `paragraph_index` 是分段算法的数组下标
- 一旦 `smartSplit` 算法变更（改一个正则），段落边界变化 → 下标全部错位
- 19K 条翻译全部指向错误的原文段落

## 二、解决方案：段落身份指纹

```
新表 paragraphs：
  id UUID PK            ← 不可变身份
  book_id TEXT          ← 所属书
  position INTEGER      ← 当前顺序（可变，仅用于排序）
  content_hash TEXT     ← SHA256(原文段落) —— 身份指纹，不变
  content TEXT          ← 原文段落内容
```

**核心思想：** `content_hash` 是段落的"身份证"。算法变了，段落内容没变 → 哈希没变 → 翻译通过哈希仍能匹配。

## 三、迁移步骤（幂等，可回滚）

### Step 1: 建表（Supabase SQL Editor 执行）

```sql
-- 段落表（不可变身份）
CREATE TABLE IF NOT EXISTS paragraphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(book_id, content_hash)
);

-- translations 加段落引用
ALTER TABLE translations ADD COLUMN IF NOT EXISTS paragraph_id UUID REFERENCES paragraphs(id);

-- 索引
CREATE INDEX IF NOT EXISTS idx_paragraphs_book ON paragraphs(book_id, position);
CREATE INDEX IF NOT EXISTS idx_paragraphs_hash ON paragraphs(content_hash);
CREATE INDEX IF NOT EXISTS idx_translations_para ON translations(paragraph_id);
```

### Step 2: 生成段落记录（Python 脚本，本机运行）

运行 `tools/migrate-paragraphs.py`：
1. 读取所有书的 zh 段落（service_role）
2. 每段计算 SHA256 → 插入 paragraphs 表
3. 更新 translations.paragraph_id（按 book_id+paragraph_index 匹配）

### Step 3: 验证（SQL）

```sql
-- 应返回 0（没有未关联的翻译）
SELECT COUNT(*) FROM translations t
LEFT JOIN paragraphs p ON p.id = t.paragraph_id
WHERE t.language != 'zh' AND t.paragraph_id IS NULL;
```

### Step 4: 双写期（1 周）

新写入的翻译同时写 paragraph_id（Edge Function 更新）；
旧路径（paragraph_index）继续可用作为 fallback。

### Step 5: 切换 + 回滚预案

- 切换：前端/Edge Function 全部改用 paragraph_id 查询
- 回滚：`ALTER TABLE translations DROP COLUMN paragraph_id; DROP TABLE paragraphs;`
  （旧数据没被动过，回滚无损失）

## 四、兼容策略

迁移期间：
- 旧翻译：通过 (book_id, paragraph_index) → 查 paragraphs.position 找到 id
- 新翻译：直接带 paragraph_id 写入
- 阅读展示：按 position 排序输出（顺序不变）

## 五、收益

1. smartSplit 算法升级 → 旧翻译通过哈希自动对齐 ✅
2. 段落去重：同书相同段落只存一次 ✅
3. 跨书段落匹配：为翻译记忆库（D2）打地基 ✅
4. 未来支持"段落合并/拆分"而不丢翻译 ✅
