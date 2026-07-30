# 语桥 ReadBridge — 协作双语阅读平台

> 🌐 [readbridge.cn](https://readbridge.cn)  
> 📖 AI 提供翻译初稿，社区逐段精修。翻译界的 GitHub。

---

## 项目简介

语桥 ReadBridge 是一个**协作翻译平台**。核心理念：像开源代码一样协作翻译每一本书。

- 📚 中英双语对照阅读（支持英/日/韩/法四种目标语言）
- ✏️ 逐段翻译改进，每段有完整版本历史 + Diff 对比
- 📤 上传 TXT 书籍，社区一起翻译
- 👥 翻译投票、评论、实时协作
- 📜 智能章节检测与分页浏览

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML/CSS/JS（单文件 SPA） |
| 后端/数据库 | [Supabase](https://supabase.com)（PostgreSQL + Auth + Realtime） |
| 部署 | GitHub Pages + 自定义域名 |
| 批量翻译 | DeepSeek API（Python 脚本） |

---

## 项目结构

```
bilingual-reader/
├── index.html          # 主应用（前端 SPA）
├── batch_translate.py  # 批量翻译脚本（已忽略提交，含 API Key）
├── .gitignore
├── README.md
└── .git/
```

---

## 数据库状态

> ⚠️ Supabase 免费层项目在 7 天无活动后会自动休眠。
> 如果网站显示"数据库离线"，请在 [Supabase Dashboard](https://supabase.com/dashboard) 中手动恢复项目。

---

## 开发说明

### 部署
推送到 `master` 分支 → GitHub Pages 自动部署 → [readbridge.cn](https://readbridge.cn)

### 数据库
所有数据存储在 Supabase PostgreSQL 中。表结构：
- `books` — 书籍元数据
- `translations` — 逐段翻译（book_id + paragraph_index + language + version）
- `comments` — 段落评论
- `profiles` — 用户信息
- `translation_votes` — 翻译投票

### 安全
- RLS（Row Level Security）策略已启用
- 预置书籍数据硬编码在 HTML 中（公版书）
- API Key 统一管理，不提交到仓库

---

## License

MIT
