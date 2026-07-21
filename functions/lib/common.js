/**
 * Shared helpers for Pages Functions.
 */

export const MODEL = "gpt-image-2";
export const MAX_N = 4;
export const MAX_PROMPT_LEN = 4000;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const UPSTREAM_TIMEOUT_MS = 120000;
export const MAX_HYDRATE_IMAGES = 4;
export const MAX_HYDRATE_BYTES = 8 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

// 画幅 x 清晰度 -> 像素 size（按常见 OpenAI 兼容站校准；可按上游再调）
export const SIZE_TABLE = {
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

export const QUALITY_ALIAS = {
  "1k": "low",
  "2k": "medium",
  "4k": "high",
};

export const ASPECTS = new Set(["3:4", "4:3", "9:16", "16:9"]);
export const QUALITIES = new Set(["1k", "2k", "4k"]);

// 简易内存限流：每个 isolate 独立计数（Pages 无状态时按实例生效）
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_PER_WINDOW = 12;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_LIMIT = 8;
const FAIL_BLOCK_MS = 5 * 60 * 1000;

const rateBuckets = new Map();
const failBuckets = new Map();

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export function normalizeBaseUrl(raw) {
  if (!raw) return "";
  return String(raw).trim().replace(/\/+$/, "");
}

export function safeErrorMessage(err) {
  const msg = err && err.message ? String(err.message) : "未知错误";
  return msg.replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]");
}

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** 恒定时间比较，降低计时侧信道风险 */
export function timingSafeEqual(a, b) {
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  const len = Math.max(sa.length, sb.length);
  let mismatch = sa.length === sb.length ? 0 : 1;
  for (let i = 0; i < len; i += 1) {
    const ca = i < sa.length ? sa.charCodeAt(i) : 0;
    const cb = i < sb.length ? sb.charCodeAt(i) : 0;
    mismatch |= ca ^ cb;
  }
  return mismatch === 0;
}

function pruneMap(map, now, maxAge) {
  for (const [key, value] of map) {
    const stamp = value.resetAt || value.blockedUntil || 0;
    if (stamp + maxAge < now) map.delete(key);
  }
}

export function checkRateLimit(ip) {
  const now = Date.now();
  pruneMap(rateBuckets, now, RATE_WINDOW_MS * 3);

  let bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_PER_WINDOW) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return {
      ok: false,
      retryAfter,
      error: `请求过于频繁，请 ${retryAfter} 秒后再试`,
    };
  }
  return { ok: true };
}

export function checkPasswordFailures(ip) {
  const now = Date.now();
  pruneMap(failBuckets, now, FAIL_WINDOW_MS * 2);
  const bucket = failBuckets.get(ip);
  if (bucket?.blockedUntil && bucket.blockedUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
    return {
      ok: false,
      retryAfter,
      error: `密码错误次数过多，请 ${retryAfter} 秒后再试`,
    };
  }
  return { ok: true };
}

export function recordPasswordFailure(ip) {
  const now = Date.now();
  let bucket = failBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + FAIL_WINDOW_MS, blockedUntil: 0 };
  }
  bucket.count += 1;
  if (bucket.count >= FAIL_LIMIT) {
    bucket.blockedUntil = now + FAIL_BLOCK_MS;
    bucket.count = 0;
    bucket.resetAt = now + FAIL_WINDOW_MS;
  }
  failBuckets.set(ip, bucket);
}

export function clearPasswordFailures(ip) {
  failBuckets.delete(ip);
}

export async function parseUpstreamError(res) {
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

export function extractImages(payload) {
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.images)
      ? payload.images
      : [];

  const images = [];
  for (const item of list) {
    if (item == null) continue;
    if (typeof item === "string") {
      if (item.startsWith("http")) images.push({ url: item });
      else images.push({ b64_json: item });
      continue;
    }
    if (typeof item !== "object") continue;
    if (item.b64_json) {
      images.push({ b64_json: item.b64_json, mime: item.mime || item.mime_type });
      continue;
    }
    if (item.b64) {
      images.push({ b64_json: item.b64, mime: item.mime || item.mime_type });
      continue;
    }
    if (item.url) {
      images.push({ url: item.url, mime: item.mime || item.mime_type });
    }
  }
  return images;
}

function bytesToBase64(bytes) {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    // 避免 ...spread 在大数组上爆栈
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

export async function hydrateRemoteImages(images) {
  const out = [];
  let hydrated = 0;

  for (const img of images) {
    if (img.b64_json) {
      out.push({ b64_json: img.b64_json, mime: img.mime || "image/png" });
      continue;
    }
    if (!img.url) continue;
    if (hydrated >= MAX_HYDRATE_IMAGES) {
      out.push({ url: img.url, mime: img.mime });
      continue;
    }
    try {
      const res = await fetch(img.url);
      if (!res.ok) {
        out.push({ url: img.url, mime: img.mime });
        continue;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_HYDRATE_BYTES) {
        out.push({ url: img.url, mime: img.mime || res.headers.get("content-type") });
        continue;
      }
      const mime =
        img.mime ||
        res.headers.get("content-type") ||
        "image/png";
      out.push({
        b64_json: bytesToBase64(new Uint8Array(buf)),
        mime: mime.split(";")[0].trim(),
      });
      hydrated += 1;
    } catch {
      out.push({ url: img.url, mime: img.mime });
    }
  }
  return out;
}

export function buildImageForm({
  prompt,
  n,
  pixelSize,
  qualityValue,
  aspect,
  referenceBlob,
  referenceName,
  referenceType,
}) {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt);
  form.append("n", String(n));
  form.append("size", pixelSize);
  form.append("quality", qualityValue);
  form.append("aspect_ratio", aspect);
  form.append("response_format", "b64_json");
  form.append(
    "image",
    new File([referenceBlob], referenceName, { type: referenceType }),
  );
  return form;
}

export function buildGenerationBody({
  prompt,
  n,
  pixelSize,
  qualityValue,
  aspect,
  includeAspect = true,
}) {
  const body = {
    model: MODEL,
    prompt,
    n,
    size: pixelSize,
    quality: qualityValue,
    response_format: "b64_json",
  };
  if (includeAspect) body.aspect_ratio = aspect;
  return body;
}