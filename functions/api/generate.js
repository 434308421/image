/**
 * Cloudflare Pages Function: POST /api/generate
 * Env: BASE_URL, API_KEY, ACCESS_PASSWORD
 * Model fixed: gpt-image-2
 */

const MODEL = "gpt-image-2";
const MAX_N = 4;
const MAX_PROMPT_LEN = 4000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

// 画幅 × 清晰度 → 像素 size（OpenAI 兼容常见写法）
const SIZE_TABLE = {
  "1k": {
    "3:4": "768x1024",
    "4:3": "1024x768",
    "9:16": "576x1024",
    "16:9": "1024x576",
  },
  "2k": {
    "3:4": "1024x1365",
    "4:3": "1365x1024",
    "9:16": "768x1365",
    "16:9": "1365x768",
  },
  "4k": {
    "3:4": "1536x2048",
    "4:3": "2048x1536",
    "9:16": "1152x2048",
    "16:9": "2048x1152",
  },
};

// 同时附带 low/medium/high，兼容只认这套 quality 的上游
const QUALITY_ALIAS = {
  "1k": "low",
  "2k": "medium",
  "4k": "high",
};

const ASPECTS = new Set(["3:4", "4:3", "9:16", "16:9"]);
const QUALITIES = new Set(["1k", "2k", "4k"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeBaseUrl(raw) {
  if (!raw) return "";
  return String(raw).trim().replace(/\/+$/, "");
}

function safeErrorMessage(err) {
  const msg = err && err.message ? String(err.message) : "未知错误";
  return msg.replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]");
}

async function parseUpstreamError(res) {
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    const msg =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      text ||
      `上游错误 ${res.status}`;
    return String(msg).replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]");
  } catch {
    return (text || `上游错误 ${res.status}`).replace(
      /sk-[a-zA-Z0-9_-]+/g,
      "[REDACTED]",
    );
  }
}

function extractImages(payload) {
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.images)
      ? payload.images
      : [];

  const images = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (item.b64_json) {
      images.push({ b64_json: item.b64_json });
      continue;
    }
    if (item.b64) {
      images.push({ b64_json: item.b64 });
      continue;
    }
    if (item.url) {
      images.push({ url: item.url });
      continue;
    }
    if (typeof item === "string") {
      if (item.startsWith("http")) images.push({ url: item });
      else images.push({ b64_json: item });
    }
  }
  return images;
}

async function hydrateRemoteImages(images) {
  const out = [];
  for (const img of images) {
    if (img.b64_json) {
      out.push({ b64_json: img.b64_json });
      continue;
    }
    if (!img.url) continue;
    try {
      const res = await fetch(img.url);
      if (!res.ok) {
        out.push({ url: img.url });
        continue;
      }
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      out.push({ b64_json: btoa(binary) });
    } catch {
      out.push({ url: img.url });
    }
  }
  return out;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const baseUrl = normalizeBaseUrl(env.BASE_URL);
    const apiKey = env.API_KEY;
    const accessPassword = env.ACCESS_PASSWORD;

    if (!baseUrl || !apiKey || !accessPassword) {
      return json(
        {
          error:
            "服务未配置完整：请在 Cloudflare 设置 BASE_URL、API_KEY、ACCESS_PASSWORD",
        },
        500,
      );
    }

    const form = await request.formData();
    const password = String(form.get("password") || "");
    const prompt = String(form.get("prompt") || "").trim();
    const aspect = String(form.get("aspect") || "").trim();
    const qualityRaw = String(form.get("quality") || "")
      .trim()
      .toLowerCase();
    const nRaw = String(form.get("n") || "1").trim();
    const imageFile = form.get("image");

    if (password !== accessPassword) {
      return json({ error: "访问密码错误" }, 401);
    }

    if (!prompt) {
      return json({ error: "请填写提示词" }, 400);
    }
    if (prompt.length > MAX_PROMPT_LEN) {
      return json({ error: `提示词过长（最多 ${MAX_PROMPT_LEN} 字）` }, 400);
    }
    if (!ASPECTS.has(aspect)) {
      return json({ error: "尺寸无效，请选择 3:4 / 4:3 / 9:16 / 16:9" }, 400);
    }
    if (!QUALITIES.has(qualityRaw)) {
      return json({ error: "清晰度无效，请选择 1K / 2K / 4K" }, 400);
    }

    const n = Number.parseInt(nRaw, 10);
    if (!Number.isFinite(n) || n < 1 || n > MAX_N) {
      return json({ error: `生成数量需为 1–${MAX_N}` }, 400);
    }

    let hasReference = false;
    let referenceBlob = null;
    let referenceName = "reference.png";
    let referenceType = "image/png";

    if (imageFile && typeof imageFile === "object" && imageFile.size > 0) {
      if (imageFile.size > MAX_IMAGE_BYTES) {
        return json({ error: "参考图不能超过 10MB" }, 400);
      }
      const type = (imageFile.type || "").toLowerCase();
      if (type && !ALLOWED_IMAGE_TYPES.has(type)) {
        return json({ error: "参考图仅支持 PNG / JPEG / WebP" }, 400);
      }
      hasReference = true;
      referenceBlob = imageFile;
      referenceName = imageFile.name || referenceName;
      referenceType = type || referenceType;
    }

    const pixelSize = SIZE_TABLE[qualityRaw][aspect];
    const qualityAlias = QUALITY_ALIAS[qualityRaw];
    // 上游常见两种：quality=1K/2K/4K 或 low/medium/high
    const qualityForApi = qualityRaw.toUpperCase();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    let upstreamRes;
    try {
      if (hasReference) {
        // 有参考图：优先走 images/edits（multipart）
        const upstreamForm = new FormData();
        upstreamForm.append("model", MODEL);
        upstreamForm.append("prompt", prompt);
        upstreamForm.append("n", String(n));
        upstreamForm.append("size", pixelSize);
        upstreamForm.append("quality", qualityForApi);
        // 兼容字段：部分站认 aspect_ratio / response_format
        upstreamForm.append("aspect_ratio", aspect);
        upstreamForm.append("response_format", "b64_json");
        upstreamForm.append(
          "image",
          new File([referenceBlob], referenceName, { type: referenceType }),
        );

        upstreamRes = await fetch(`${baseUrl}/v1/images/edits`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: upstreamForm,
          signal: controller.signal,
        });

        // 若 edits 不存在，回退到 generations + 仍带 image（部分兼容站这样实现图生图）
        if (upstreamRes.status === 404 || upstreamRes.status === 405) {
          const fallbackForm = new FormData();
          fallbackForm.append("model", MODEL);
          fallbackForm.append("prompt", prompt);
          fallbackForm.append("n", String(n));
          fallbackForm.append("size", pixelSize);
          fallbackForm.append("quality", qualityForApi);
          fallbackForm.append("aspect_ratio", aspect);
          fallbackForm.append("response_format", "b64_json");
          fallbackForm.append(
            "image",
            new File([referenceBlob], referenceName, { type: referenceType }),
          );

          upstreamRes = await fetch(`${baseUrl}/v1/images/generations`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            body: fallbackForm,
            signal: controller.signal,
          });
        }
      } else {
        const body = {
          model: MODEL,
          prompt,
          n,
          size: pixelSize,
          quality: qualityForApi,
          aspect_ratio: aspect,
          response_format: "b64_json",
        };

        upstreamRes = await fetch(`${baseUrl}/v1/images/generations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        // 若上游不认 1K/2K/4K，自动用 low/medium/high 重试一次
        if (!upstreamRes.ok && (upstreamRes.status === 400 || upstreamRes.status === 422)) {
          const errText = await upstreamRes.clone().text();
          if (/quality|size|invalid/i.test(errText)) {
            const retryBody = {
              model: MODEL,
              prompt,
              n,
              size: pixelSize,
              quality: qualityAlias,
              response_format: "b64_json",
            };
            upstreamRes = await fetch(`${baseUrl}/v1/images/generations`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(retryBody),
              signal: controller.signal,
            });
          }
        }
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        return json({ error: "生成超时，请稍后重试或降低清晰度/张数" }, 504);
      }
      return json({ error: `请求上游失败：${safeErrorMessage(err)}` }, 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!upstreamRes.ok) {
      const message = await parseUpstreamError(upstreamRes);
      return json({ error: message }, upstreamRes.status >= 500 ? 502 : 400);
    }

    const payload = await upstreamRes.json();
    let images = extractImages(payload);
    if (!images.length) {
      return json({ error: "上游未返回图片数据" }, 502);
    }

    // 若只有 URL，尽量转成 base64，方便前端历史存档
    if (images.some((x) => x.url && !x.b64_json)) {
      images = await hydrateRemoteImages(images);
    }

    return json({
      model: MODEL,
      aspect,
      quality: qualityRaw.toUpperCase(),
      size: pixelSize,
      n,
      used_reference: hasReference,
      images,
    });
  } catch (err) {
    return json({ error: `服务异常：${safeErrorMessage(err)}` }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}
