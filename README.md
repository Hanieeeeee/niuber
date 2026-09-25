# Ring Records｜纽北圈速档案

独立、中英双语的纽伯格林官方圈速档案。数据来自纽伯格林官网公开页面，支持定时同步与可核对来源。

## 已验证的数据获取方案

| 入口 | URL | 获取方式 |
|------|-----|----------|
| 官方纪录榜单 | `https://nuerburgring.de/info/nuerburgring/records?locale=en` | 页面壳内嵌 `data-url="/widget/{id}"`。**经验证可用的官方结构化片段接口**：`GET /widget/{id}?locale=en`（带 `X-Requested-With: XMLHttpRequest`），返回 `$('#widget_cont_*').replaceWith("<section class=\"accordion\">…")`。适配器从壳页动态发现 widget，解包 HTML 后解析 `table.contenttable`。 |
| 官方纪录新闻 | `https://nuerburgring.de/news/categories/rekordfahrten?locale=en` | 服务端渲染列表 + `?page=N` 分页；解析标题、日期、摘要与原文链接。 |

> 说明：官网**没有**面向公众的 JSON 圈速 API，也没有 WebSocket/推送。`/widget/{id}` 是官方前端自己的片段端点（HTML-in-jQuery），比整页 HTML 更稳定、更易解析。无实时推送 → 后台定时同步是正确策略。

**官方分类（实抓，完整保留）**

- **Nordschleife**（20.832 km，T13 起终点，flying start）
  - Prototypes / pre-production vehicles
  - COMBUSTION & HYBRID VEHICLES：Compact cars · Mid-range cars · Executive cars · SUVs… · Sports cars · Super sports cars · Modified Vehicles
  - ELECTRIC VEHICLES：Mid-range cars · Executive cars · SUVs… · Super sports cars · Modified Vehicles · Autonomous Driving
- **Grand-Prix-Strecke**（5.148 km，flying start）
  - Super sports cars

不同赛道布局与 `timing_key` **独立分榜**，绝不混排。跨分类汇总由前端标注「本站汇总排序 / Site summary ranking」。

**圈速归一化**：官方存在 `7:24,172`、`7:29.81`、`7:36:698` 等写法，解析器统一为整数毫秒，展示为 `mm:ss.SSS`。

## 架构

```
adapters/     官方 HTML 解析、时间/日期/品牌、分类翻译表
server/       Express API + node:sqlite + node-cron 同步调度
js/ + css/    双语前端（index.html 入口）
data/         SQLite 库、published.json、快照
schema.sql    持久化表结构
```

### 同步与更新

- 后台 `node-cron` 默认每 **30 分钟**抓取（`RR_SYNC_INTERVAL_MINUTES`），**无访问者时也会运行**。
- 前端每 60 秒检查 `/api/sync/status` 的 `data_version`，变更则拉取 `/api/published` 刷新。
- 同步流水线：fetch（超时/重试）→ 解析 → **完整性校验** → 按身份键 upsert（去重）→ 内容哈希版本 → 发布 `published.json` + 快照。
- **失败不删数据**：校验失败或网络失败时标记 `sync_runs.status=failed`，保留上一有效版本；页面显示状态提示。
- 刷新页面**不会**伪造同步时间：时间戳只在真实 sync run 成功结束时写入。

### 主要 API

- `GET /api/published` — 全量已发布数据 + meta
- `GET /api/records?category=&track=&brand=&year=&powertrain=&q=`
- `GET /api/categories` — 官方分类树
- `GET /api/news`
- `GET /api/sync/status` — 最近检查 / 最近成功 / 是否过期
- `POST /api/admin/sync` — 手动触发（可选 `Authorization: Bearer $RR_ADMIN_TOKEN`）

## 本地运行

```bash
cp .env.example .env
npm install
npm run sync          # 首次拉取官方数据（真实网络）
npm start             # http://localhost:8787
# 若端口被占用：PORT=8788 npm start
```

仅前端预览（读取 `data/published.json`，无自动同步）：

```bash
# 在项目根目录
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 免费部署（推荐）

前端已是 `index.html` + 静态资源，数据在 `data/published.json`。**不跑 Node 服务也能上线**；用 GitHub Actions 定时同步即可无人值守更新。

### 方案 A：Cloudflare Pages / GitHub Pages + Actions 同步（完全免费）

1. 把本目录推到 GitHub 仓库。
2. 确认提交了 `data/published.json`、`assets/`、`.github/workflows/sync.yml`（不要提交 `data/*.db`）。
3. **Cloudflare Pages**（或 GitHub Pages）连接该仓库：
   - 构建命令：留空（纯静态）
   - 输出目录：`/`（仓库根目录）
4. 仓库 Settings → Actions → 允许写权限（workflow 会提交同步结果）。
5. 手动跑一次 Actions 的 `ring-records-sync`，之后每 30 分钟自动抓官方数据并更新 `published.json`。
6. 访问分配的域名；前端会读 `./data/published.json`（静态模式，顶栏会提示）。

> GitHub Pages 若挂在 `https://user.github.io/repo/` 子路径，请把前端资源保持相对路径 `./`（已是相对路径，可直接用）。

### 方案 B：Render / Fly.io 免费档跑完整 Node 服务

1. 新建 Web Service，根目录为本仓库。
2. 环境变量：复制 `.env.example`（`PORT` 平台会注入）。
3. Build：`npm ci`　Start：`npm start`
4. Render 免费档会休眠；可用外部 cron 唤醒，或只用方案 A。

### 本地/服务器完整版

1. Node.js ≥ 22（使用内置 `node:sqlite`）。
2. `cp .env.example .env && npm ci && npm run sync && npm start`
3. 外部 cron 时设 `RR_DISABLE_SCHEDULER=1` 并定时 `npm run sync`（见 `deploy/cron-examples.md`）。

Docker：`node:22-slim` 挂载 `data/` 卷即可。

## 数据库

见 `schema.sql`：`tracks` · `categories` · `records` · `news_items` · `sync_runs` · `data_versions`。

纪录身份键：`(track_id, category_id, vehicle_en, lap_time_ms, record_date)` — **不同套件/版本不会被错误合并**；重复同步幂等。

## 双语

- 默认简体中文，右上角 `中文 / EN` 切换，记忆于 `localStorage`。
- 切换保留赛道、分类、筛选、搜索、排序与对比勾选。
- 车型/人名保留官方拼写；分类为统一翻译表，并始终可查看官方英文原文。
- 中文新闻摘要若为本站翻译，显示「本站译文」。

## 演示数据隔离

正式数据只来自官网同步。若需开发夹具，请放在 `tests/fixtures/` 并仅供单测使用，**不得**写入 `data/published.json`。

## 验收对照

- 官方来源可核对：每条纪录含 `source_url`
- 分类覆盖完整：按官网 accordion 原样映射
- 圈速排序：整数毫秒
- 计时口径不混排：`track_id` + `timing_key` 隔离
- 双语完整：i18n 覆盖导航/表格/详情/筛选/状态
- 同步失败可恢复：保留上次数据 + 状态条
- 后台任务：node-cron 独立于 HTTP 访问
