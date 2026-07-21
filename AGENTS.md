# AGENTS.md

## 概况
- 名称：gptimage2-web
- 用途：给朋友使用的 gpt-image-2 生图网页（OpenAI 兼容）
- 技术栈：Cloudflare Pages + Pages Functions + 原生 HTML/CSS/JS
- 当前状态：可部署增强版（限流、健康检查、取消生成、历史筛选）

## 目录
- `public/` 前端
- `functions/api/generate.js` 生图代理
- `functions/api/health.js` 健康检查
- `functions/lib/common.js` 共享工具（限流、校验、图片解析）
- `scripts/smoke-test.mjs` 冒烟测试
- `wrangler.toml` Pages 配置

## 启动 / 部署
- 本地：`npm install` → 配置 `.dev.vars` → `npm run dev`
- 测试：`npm test`
- 部署：GitHub + Cloudflare Pages，输出目录 `public`；或 `npm run deploy`
- 环境变量：`BASE_URL`、`API_KEY`、`ACCESS_PASSWORD`

## 核心约定
- 模型固定 `gpt-image-2`
- 密钥与密码只放服务端环境变量
- 前端不暴露 `API_KEY` / `BASE_URL`
- 历史仅存浏览器 IndexedDB（本机，默认约 12 条）
- 尺寸：`3:4` `4:3` `9:16` `16:9`
- 清晰度：`1K` `2K` `4K`
- 密码比较使用恒定时间；按 IP 限流与失败退避
- CORS 仅同源 origin

## 修改注意
- 改上游字段映射：优先改 `functions/lib/common.js` 的 `SIZE_TABLE` / 请求体构造
- 改密码：改 Cloudflare `ACCESS_PASSWORD`，不要做网页后台；改后确认 `/api/health`
- 不要把 `.dev.vars` 提交进仓库
- 前端密码记住功能默认关闭，且仅 localStorage