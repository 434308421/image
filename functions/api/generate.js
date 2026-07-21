/**
 * Cloudflare Pages Function: POST /api/generate
 * Env: BASE_URL, API_KEY, ACCESS_PASSWORD
 * Model fixed: gpt-image-2
 */

import {
  ALLOWED_IMAGE_TYPES,
  ASPECTS,
  MAX_IMAGE_BYTES,
  MAX_N,
  MAX_PROMPT_LEN,
  MODEL,
  QUALITIES,
  QUALITY_ALIAS,
  SIZE_TABLE,
  UPSTREAM_TIMEOUT_MS,
  buildGenerationBody,
  buildImageForm,
  checkPasswordFailures,
  checkRateLimit,
  clearPasswordFailures,
  clientIp,
  extractImages,
  hydrateRemoteImages,
  json,
  normalizeBaseUrl,
  parseUpstreamError,
  recordPasswordFailure,
  safeErrorMessage,
  timingSafeEqual,
} from "../lib/common.js";

function sameOriginHeaders(request) {
  return {
    "access-control-allow-origin": new URL(request.url).origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

async function postUpstream({ url, apiKey, body, isForm, signal }) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (!isForm) headers["Content-Type"] = "application/json";
  return fetch(url, {
    method: "POST",
    headers,
    body: isForm ? body : JSON.stringify(body),
    signal,
  });
}

function looksLikeQualitySizeError(text) {
  return /quality|size|invalid|aspect/i.test(text || "");
}

async function postWithQualityRetry({
  baseUrl,
  path,
  apiKey,
  signal,
  isForm,
  buildBody,
  primaryQuality,
  aliasQuality,
}) {
  let res = await postUpstream({
    url: `${baseUrl}${path}`,
    apiKey,
    body: buildBody(primaryQuality),
    isForm,
    signal,
  });

  if (res.ok || (res.status !== 400 && res.status !== 422)) {
    return res;
  }

  const errText = await res.clone().text();
  if (!looksLikeQualitySizeError(errText)) return res;

  return postUpstream({
    url: `${baseUrl}${path}`,
    apiKey,
    body: buildBody(aliasQuality),
    isForm,
    signal,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = clientIp(request);

  try {
    const rate = checkRateLimit(ip);
    if (!rate.ok) {
      return json(
        { error: rate.error },
        429,
        { "retry-after": String(rate.retryAfter) },
      );
    }

    const failGate = checkPasswordFailures(ip);
    if (!failGate.ok) {
      return json(
        { error: failGate.error },
        429,
        { "retry-after": String(failGate.retryAfter) },
      );
    }

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

    if (!timingSafeEqual(password, accessPassword)) {
      recordPasswordFailure(ip);
      return json({ error: "访问密码错误" }, 401);
    }
    clearPasswordFailures(ip);

    if (!prompt) return json({ error: "请填写提示词" }, 400);
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
    const qualityForApi = qualityRaw.toUpperCase();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let upstreamRes;
    try {
      if (hasReference) {
        const makeForm = (qualityValue) =>
          buildImageForm({
            prompt,
            n,
            pixelSize,
            qualityValue,
            aspect,
            referenceBlob,
            referenceName,
            referenceType,
          });

        upstreamRes = await postWithQualityRetry({
          baseUrl,
          path: "/v1/images/edits",
          apiKey,
          signal: controller.signal,
          isForm: true,
          primaryQuality: qualityForApi,
          aliasQuality: qualityAlias,
          buildBody: makeForm,
        });

        // edits 不支持时回退 generations + image
        if (upstreamRes.status === 404 || upstreamRes.status === 405) {
          upstreamRes = await postWithQualityRetry({
            baseUrl,
            path: "/v1/images/generations",
            apiKey,
            signal: controller.signal,
            isForm: true,
            primaryQuality: qualityForApi,
            aliasQuality: qualityAlias,
            buildBody: makeForm,
          });
        }
      } else {
        upstreamRes = await postWithQualityRetry({
          baseUrl,
          path: "/v1/images/generations",
          apiKey,
          signal: controller.signal,
          isForm: false,
          primaryQuality: qualityForApi,
          aliasQuality: qualityAlias,
          buildBody: (qualityValue) =>
            buildGenerationBody({
              prompt,
              n,
              pixelSize,
              qualityValue,
              aspect,
              includeAspect: qualityValue === qualityForApi,
            }),
        });
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        return json(
          {
            error:
              "生成超时（约 120 秒）。请稍后重试，或降低清晰度/张数（4K 与多张会更慢）",
          },
          504,
        );
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

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: sameOriginHeaders(context.request),
  });
}