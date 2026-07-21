# GPT Image 2 Web

给朋友用的 OpenAI 兼容生图网页。模型固定 `gpt-image-2`。

- 你配置：`BASE_URL`、`API_KEY`、访问密码
- 朋友使用：提示词、尺寸、清晰度、数量、参考图
- 历史：浏览器 IndexedDB 本地保存，可查看、下载、复制提示词、搜索筛选

## 功能

- 提示词输入（最多 4000 字）
- 尺寸：`3:4` / `4:3` / `9:16` / `16:9`
- 清晰度：`1K` / `2K` / `4K`
- 生成数量：1–4
- 访问密码（Cloudflare 环境变量 `ACCESS_PASSWORD`）
  - 可选「记住密码」（默认关闭；仅本机当前浏览器）
  - 密码错误次数过多会临时锁定
- 参考图上传（点击或拖入；优先 `/v1/images/edits`，失败回退兼容路径）
- 生成中可取消；同参数再生成
- 历史记录（本机浏览器 IndexedDB，默认最多约 12 条）
  - 查看大图（左右切换）
  - 下载单张 / 全部（按真实 MIME 扩展名）
  - 复制提示词 / 一键填回表单
  - 搜索提示词、按画幅/清晰度筛选
- 健康检查：`GET /api/health`

## 目录

```text
public/                    前端静态页
functions/api/generate.js  生图代理
functions/api/health.js    健康检查
functions/lib/common.js    共享校验/限流/解析
scripts/smoke-test.mjs     纯函数冒烟测试
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

3. 启动 / 测试

```powershell
npm run dev
npm test
```

浏览器打开终端提示的本地地址。

## 部署到 Cloudflare Pages（推荐）

### 方式 A：GitHub 自动部署

1. 推送到 GitHub（本仓库 `origin`）
2. Cloudflare Dashboard → Workers & Pages → 连接该仓库
3. 构建设置：
   - Framework preset: `None`
   - Build command: 留空
   - Build output directory: `public`
4. 环境变量（Production，建议标为 Secret）：
   - `BASE_URL`：OpenAI 兼容接口根地址，例如 `https://api.example.com`（不要末尾 `/v1`）
   - `API_KEY`：接口密钥
   - `ACCESS_PASSWORD`：朋友访问密码
5. 部署完成后访问 `*.pages.dev`，并检查 `GET /api/health` 是否 `configured: true`

### 方式 B：CLI 直接部署

```powershell
cd D:\test\20260720_gptimage2-web
npx wrangler pages deploy public --project-name=gptimage2-web
```

Functions 目录会随 Pages 部署映射：

- `POST /api/generate`
- `GET /api/health`

### 修改访问密码

Cloudflare Pages 项目 → Settings → Environment variables → 修改 `ACCESS_PASSWORD` → 重新部署（或按面板提示使新变量生效）→ 用 `/api/health` 确认 `ACCESS_PASSWORD: true`。

### 部署后检查清单

1. 打开站点首页可加载
2. `GET /api/health` 返回 `ok: true` 且三项配置均为 `true`
3. 错误密码返回 401；连续错误会 429 锁定
4. 正确密码可生成图片
5. 参考图、取消生成、历史保存与下载可用

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
- `quality` 先用 `1K/2K/4K`，失败时自动重试 `low/medium/high`

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
- 服务端按 IP 做简易请求限流与密码失败退避（isolate 内存计数，Pages 多实例时为尽力而为）
- 历史图片保存在用户浏览器本地，不经过你的服务器落盘
- 同源页面；CORS 仅回应当前 origin，不开放 `*`

## 注意事项

1. 不同 OpenAI 兼容站对 `quality` / `size` / 参考图字段支持不一致，必要时改 `functions/lib/common.js` 的 `SIZE_TABLE`
2. `*.pages.dev` 在国内多数网络可开；长期使用建议绑定自己的域名
3. 4K + 多张会更慢、更费额度；超时约 120 秒
4. 浏览器历史默认最多保留约 12 条（IndexedDB）；存储不足会自动清理旧记录；换浏览器/清站点数据会丢失
5. URL 型上游图片会尽量转 base64；单张过大时保留 URL，避免 Worker 内存压力