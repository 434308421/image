/**
 * Cloudflare Pages Function: GET /api/health
 * 只读健康检查，不暴露密钥。
 */

import { json, normalizeBaseUrl } from "../lib/common.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const hasBase = Boolean(normalizeBaseUrl(env.BASE_URL));
  const hasKey = Boolean(env.API_KEY);
  const hasPassword = Boolean(env.ACCESS_PASSWORD);
  const configured = hasBase && hasKey && hasPassword;

  return json(
    {
      ok: configured,
      service: "gptimage2-web",
      model: "gpt-image-2",
      configured,
      checks: {
        BASE_URL: hasBase,
        API_KEY: hasKey,
        ACCESS_PASSWORD: hasPassword,
      },
      time: new Date().toISOString(),
    },
    configured ? 200 : 503,
  );
}

export async function onRequestOptions(context) {
  const origin = new URL(context.request.url).origin;
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  });
}