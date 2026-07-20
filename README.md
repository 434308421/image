# GPT Image 2 Web

给朋友用的 OpenAI 兼容生图网页。模型固定 `gpt-image-2`。

- 你配置：`BASE_URL`、`API_KEY`、访问密码
- 朋友使用：提示词、尺寸、清晰度、数量、参考图
- 历史：浏览器 IndexedDB 本地保存，可查看、下载、复制提示词

## 功能

- 提示词输入
- 尺寸：`3:4` / `4:3` / `9:16` / `16:9`
- 清晰度：`1K` / `2K` / `4K`
- 生成数量：1–4
- 访问密码（Cloudflare 环境变量 `ACCESS_PASSWORD`，可随时在后台修改）
- 参考图上传（优先 `/v1/images/edits`，失败回退兼容路径）
- 历史记录（本机浏览器 IndexedDB）
  - 查看大图
  - 下载单张 / 全部
  - 复制提示词
  - 一键填回表单

## 目录

```text
public/                 前端静态页
functions/api/generate.js   Cloudflare Pages Function 代理
wrangler.toml
.dev.vars.example
```

## 本地开发

1. 安装依赖

```powershell
cd D:\test\20260720_gptimage2-web
npm install
```

2. 配置本地环境变量

```powershell
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入 BASE_URL / API_KEY / ACCESS_PASSWORD
```

3. 启动

```powershell
npm run dev
```

浏览器打开终端提示的本地地址。

## 部署到 Cloudflare Pages（推荐）

1. 把本仓库推到 GitHub
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. 构建设置：
   - Framework preset: `None`
   - Build command: 留空
   - Build output directory: `public`
4. 环境变量（Production）：
   - `BASE_URL`：你的 OpenAI 兼容接口根地址，例如 `https://api.example.com`（不要末尾 `/v1`）
   - `API_KEY`：接口密钥
   - `ACCESS_PASSWORD`：朋友访问密码
5. 部署完成后把 `*.pages.dev` 链接发给朋友

Functions 目录 `functions/api/generate.js` 会自动映射为 `POST /api/generate`。

### 修改访问密码

Cloudflare Pages 项目 → Settings → Environment variables → 修改 `ACCESS_PASSWORD` → 重新部署（或按面板提示使新变量生效）。

## 接口约定

前端：`POST /api/generate`（`multipart/form-data`）

| 字段 | 说明 |
|------|------|
| password | 访问密码 |
| prompt | 提示词 |
| aspect | `3:4` / `4:3` / `9:16` / `16:9` |
| quality | `1k` / `2k` / `4k` |
| n | 1–4 |
| image | 可选参考图 |

上游：

- 文生图：`POST {BASE_URL}/v1/images/generations`
- 有参考图：优先 `POST {BASE_URL}/v1/images/edits`，不支持时回退

模型固定：`gpt-image-2`。

尺寸映射（可按上游实际能力再调）：

| 清晰度 | 3:4 | 4:3 | 9:16 | 16:9 |
|--------|-----|-----|------|------|
| 1K | 768x1024 | 1024x768 | 576x1024 | 1024x576 |
| 2K | 1024x1365 | 1365x1024 | 768x1365 | 1365x768 |
| 4K | 1536x2048 | 2048x1536 | 1152x2048 | 2048x1152 |

## 安全说明

- `API_KEY` 只存在 Cloudflare 环境变量，不进前端、不进 Git
- 访问密码用于防链接外传刷额度，不是高强度账号体系
- 历史图片保存在用户浏览器本地，不经过你的服务器落盘

## 注意事项

1. 不同 OpenAI 兼容站对 `quality` / `size` / 参考图字段支持不一致，必要时改 `functions/api/generate.js` 映射表
2. `*.pages.dev` 在国内多数网络可开；长期使用建议绑定自己的域名
3. 4K + 多张会更慢、更费额度
4. 浏览器历史默认最多保留约 20 条（IndexedDB）；换浏览器/清站点数据会丢失
