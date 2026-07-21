/**
 * Minimal pure-function smoke tests for shared helpers.
 * Run: node scripts/smoke-test.mjs
 */

import assert from "node:assert/strict";
import {
  ASPECTS,
  MODEL,
  QUALITIES,
  SIZE_TABLE,
  extractImages,
  normalizeBaseUrl,
  timingSafeEqual,
} from "../functions/lib/common.js";

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`fail - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("model fixed", () => {
  assert.equal(MODEL, "gpt-image-2");
});

test("normalizeBaseUrl strips trailing slash", () => {
  assert.equal(normalizeBaseUrl("https://api.example.com/"), "https://api.example.com");
  assert.equal(normalizeBaseUrl("  https://x.test  "), "https://x.test");
});

test("SIZE_TABLE covers all aspect/quality pairs", () => {
  for (const q of QUALITIES) {
    for (const a of ASPECTS) {
      const size = SIZE_TABLE[q][a];
      assert.match(size, /^\d+x\d+$/, `${q} ${a}`);
    }
  }
});

test("extractImages supports data/url/b64 variants", () => {
  const images = extractImages({
    data: [
      { b64_json: "AAA", mime: "image/png" },
      { b64: "BBB" },
      { url: "https://example.com/a.png" },
      "https://example.com/b.jpg",
      "CCC",
    ],
  });
  assert.equal(images.length, 5);
  assert.equal(images[0].b64_json, "AAA");
  assert.equal(images[1].b64_json, "BBB");
  assert.equal(images[2].url, "https://example.com/a.png");
  assert.equal(images[3].url, "https://example.com/b.jpg");
  assert.equal(images[4].b64_json, "CCC");
});

test("timingSafeEqual basic", () => {
  assert.equal(timingSafeEqual("secret", "secret"), true);
  assert.equal(timingSafeEqual("secret", "secreT"), false);
  assert.equal(timingSafeEqual("a", "aa"), false);
});

if (!process.exitCode) {
  console.log("all smoke tests passed");
}