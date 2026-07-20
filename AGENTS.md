# AGENTS.md

## 概况
- 名称：gptimage2-web
- 用途：给朋友使用的 gpt-image-2 生图网页（OpenAI 兼容）
- 技术栈：Cloudflare Pages + Pages Functions + 原生 HTML/CSS/JS
- 当前状态：可部署最小可用版

## 目录
- `public/` 前端
- `functions/api/generate.js` 后端代理
- `wrangler.toml` Pages 配置

## 启动 / 部署
- 本地：`npm install` → 配置 `.dev.vars` → `npm run dev`
- 部署：GitHub + Cloudflare Pages，输出目录 `public`
- 环境变量：`BASE_URL`、`API_KEY`、`ACCESS_PASSWORD`

## 核心约定
- 模型固定 `gpt-image-2`
- 密钥与密码只放服务端环境变量
- 前端不暴露 `API_KEY` / `BASE_URL`
- 历史仅存浏览器 IndexedDB（本机）
- 尺寸：`3:4` `4:3` `9:16` `16:9`
- 清晰度：`1K` `2K` `4K`

## 修改注意
- 改上游字段映射：优先改 `functions/api/generate.js` 的 `SIZE_TABLE` / 请求体
- 改密码：改 Cloudflare `ACCESS_PASSWORD`，不要做网页后台
- 不要把 `.dev.vars` 提交进仓库
