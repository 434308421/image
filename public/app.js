const HISTORY_DB = "gptimage2-db";
const HISTORY_STORE = "history";
const HISTORY_KEY_FALLBACK = "gptimage2.history.v1";
const PASSWORD_KEY = "gptimage2.password";
const REMEMBER_KEY = "gptimage2.remember_password";
const MAX_HISTORY = 12;
const MAX_N = 4;
const MAX_PROMPT_LEN = 4000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const $ = (id) => document.getElementById(id);

const form = $("gen-form");
const passwordInput = $("password");
const rememberPassword = $("remember-password");
const promptInput = $("prompt");
const promptCount = $("prompt-count");
const aspectInput = $("aspect");
const qualityInput = $("quality");
const nInput = $("n");
const imageInput = $("image");
const uploadZone = $("upload-zone");
const submitBtn = $("submit-btn");
const cancelBtn = $("cancel-btn");
const formStatus = $("form-status");
const resultEmpty = $("result-empty");
const resultGrid = $("result-grid");
const resultMeta = $("result-meta");
const downloadAllBtn = $("download-all");
const regenBtn = $("regen-btn");
const historyCount = $("history-count");
const historyEmpty = $("history-empty");
const historyList = $("history-list");
const historySearch = $("history-search");
const historyFilterAspect = $("history-filter-aspect");
const historyFilterQuality = $("history-filter-quality");
const clearHistoryBtn = $("clear-history");
const previewImg = $("preview-img");
const uploadPreview = $("upload-preview");
const uploadUi = $("upload-ui");
const clearImageBtn = $("clear-image");
const lightbox = $("lightbox");
const lightboxImg = $("lightbox-img");
const lightboxPrev = $("lightbox-prev");
const lightboxNext = $("lightbox-next");

let currentImages = [];
let currentMeta = null;
let lastParams = null;
let historyCache = [];
let previewObjectUrl = null;
let activeAbort = null;
let lightboxSources = [];
let lightboxIndex = 0;

function setStatus(text, type = "") {
  formStatus.textContent = text || "";
  formStatus.className = "status" + (type ? ` ${type}` : "");
}

function updatePromptCount() {
  const len = promptInput.value.length;
  promptCount.textContent = `${len} / ${MAX_PROMPT_LEN}`;
}

function loadPassword() {
  try {
    const remember = localStorage.getItem(REMEMBER_KEY) === "1";
    rememberPassword.checked = remember;
    if (!remember) {
      localStorage.removeItem(PASSWORD_KEY);
      return;
    }
    const saved = localStorage.getItem(PASSWORD_KEY);
    if (saved) passwordInput.value = saved;
  } catch {}
}

function savePassword(value) {
  try {
    if (rememberPassword.checked) {
      localStorage.setItem(REMEMBER_KEY, "1");
      localStorage.setItem(PASSWORD_KEY, value);
    } else {
      localStorage.setItem(REMEMBER_KEY, "0");
      localStorage.removeItem(PASSWORD_KEY);
    }
  } catch {}
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HISTORY_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const store = db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB 打开失败"));
  });
}

async function idbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readonly");
    const store = tx.objectStore(HISTORY_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const list = Array.isArray(req.result) ? req.result : [];
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      resolve(list);
    };
    req.onerror = () => reject(req.error || new Error("读取历史失败"));
  });
}

async function idbPut(entry) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    tx.objectStore(HISTORY_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("写入历史失败"));
  });
}

async function idbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    tx.objectStore(HISTORY_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("删除历史失败"));
  });
}

async function idbClear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    tx.objectStore(HISTORY_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("清空历史失败"));
  });
}

async function migrateLocalStorageIfNeeded() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY_FALLBACK);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || !data.length) {
      localStorage.removeItem(HISTORY_KEY_FALLBACK);
      return;
    }
    for (const item of data) {
      if (item && item.id) await idbPut(item);
    }
    localStorage.removeItem(HISTORY_KEY_FALLBACK);
  } catch {}
}

async function loadHistory() {
  try {
    await migrateLocalStorageIfNeeded();
    historyCache = await idbGetAll();
  } catch (err) {
    console.warn(err);
    historyCache = [];
  }
  return historyCache;
}

async function trimHistory() {
  if (historyCache.length <= MAX_HISTORY) return;
  const extra = historyCache.slice(MAX_HISTORY);
  for (const item of extra) {
    try {
      await idbDelete(item.id);
    } catch {}
  }
  historyCache = historyCache.slice(0, MAX_HISTORY);
}

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(ts);
  }
}

function mimeFromImage(img) {
  if (img?.mime) return String(img.mime).split(";")[0].trim();
  if (img?.b64_json?.startsWith("data:")) {
    const m = img.b64_json.match(/^data:([^;]+);/);
    if (m) return m[1];
  }
  return "image/png";
}

function extFromMime(mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "png";
}

function dataUrlFromImage(img) {
  if (img?.b64_json) {
    const raw = img.b64_json;
    if (raw.startsWith("data:")) return raw;
    const mime = mimeFromImage(img);
    return `data:${mime};base64,${raw}`;
  }
  if (img?.url) return img.url;
  return "";
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openLightbox(sources, index = 0) {
  lightboxSources = (sources || []).filter(Boolean);
  if (!lightboxSources.length) return;
  lightboxIndex = Math.max(0, Math.min(index, lightboxSources.length - 1));
  lightboxImg.src = lightboxSources[lightboxIndex];
  lightboxPrev.disabled = lightboxSources.length < 2;
  lightboxNext.disabled = lightboxSources.length < 2;
  if (typeof lightbox.showModal === "function") lightbox.showModal();
}

function stepLightbox(delta) {
  if (lightboxSources.length < 2) return;
  lightboxIndex = (lightboxIndex + delta + lightboxSources.length) % lightboxSources.length;
  lightboxImg.src = lightboxSources[lightboxIndex];
}

function syncSegButtons(groupSelector, attr, value) {
  document.querySelectorAll(groupSelector).forEach((btn) => {
    const active = btn.dataset[attr] === value;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
    btn.tabIndex = active ? 0 : -1;
  });
}

function bindSeg(groupSelector, attr, hiddenInput) {
  const buttons = Array.from(document.querySelectorAll(groupSelector));
  buttons.forEach((btn, idx) => {
    btn.addEventListener("click", () => {
      hiddenInput.value = btn.dataset[attr];
      syncSegButtons(groupSelector, attr, hiddenInput.value);
    });
    btn.addEventListener("keydown", (e) => {
      let next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = buttons[(idx + 1) % buttons.length];
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = buttons[(idx - 1 + buttons.length) % buttons.length];
      if (!next) return;
      e.preventDefault();
      next.focus();
      next.click();
    });
  });
  syncSegButtons(groupSelector, attr, hiddenInput.value);
}

function setN(value) {
  const n = Math.min(MAX_N, Math.max(1, Number(value) || 1));
  nInput.value = String(n);
}

function revokePreviewUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
}

function setImageFile(file) {
  if (!file) {
    imageInput.value = "";
    revokePreviewUrl();
    uploadPreview.classList.add("hidden");
    uploadUi.classList.remove("hidden");
    previewImg.removeAttribute("src");
    uploadZone.classList.remove("is-dragover");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    setStatus("参考图不能超过 10MB", "error");
    return;
  }
  const type = (file.type || "").toLowerCase();
  if (type && !["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(type)) {
    setStatus("参考图仅支持 PNG / JPEG / WebP", "error");
    return;
  }

  const dt = new DataTransfer();
  dt.items.add(file);
  imageInput.files = dt.files;
  updateUploadPreview();
}

function updateUploadPreview() {
  const file = imageInput.files && imageInput.files[0];
  revokePreviewUrl();
  if (!file) {
    uploadPreview.classList.add("hidden");
    uploadUi.classList.remove("hidden");
    previewImg.removeAttribute("src");
    return;
  }
  previewObjectUrl = URL.createObjectURL(file);
  previewImg.src = previewObjectUrl;
  uploadPreview.classList.remove("hidden");
  uploadUi.classList.add("hidden");
}

function applyParamsToForm(params) {
  if (!params) return;
  if (params.prompt != null) {
    promptInput.value = params.prompt;
    updatePromptCount();
  }
  if (params.aspect) {
    aspectInput.value = params.aspect;
    syncSegButtons("[data-aspect]", "aspect", params.aspect);
  }
  if (params.quality) {
    const q = String(params.quality).toLowerCase();
    qualityInput.value = q;
    syncSegButtons("[data-quality]", "quality", q);
  }
  if (params.n) setN(params.n);
}

function renderCurrentResults(images, meta) {
  currentImages = images || [];
  currentMeta = meta || null;

  if (!currentImages.length) {
    resultGrid.classList.add("hidden");
    resultEmpty.classList.remove("hidden");
    resultMeta.classList.add("hidden");
    resultMeta.textContent = "";
    downloadAllBtn.disabled = true;
    regenBtn.disabled = !lastParams;
    resultGrid.innerHTML = "";
    return;
  }

  resultEmpty.classList.add("hidden");
  resultGrid.classList.remove("hidden");
  downloadAllBtn.disabled = false;
  regenBtn.disabled = !lastParams;
  resultGrid.innerHTML = "";

  if (meta) {
    const bits = [
      meta.size ? `像素 ${meta.size}` : "",
      meta.aspect ? `画幅 ${meta.aspect}` : "",
      meta.quality ? `清晰度 ${String(meta.quality).toUpperCase()}` : "",
      meta.n ? `×${meta.n}` : "",
      meta.usedReference ? "含参考图" : "",
    ].filter(Boolean);
    resultMeta.textContent = bits.join(" · ");
    resultMeta.classList.toggle("hidden", !bits.length);
  } else {
    resultMeta.classList.add("hidden");
  }

  const sources = currentImages.map((img) => dataUrlFromImage(img)).filter(Boolean);

  currentImages.forEach((img, idx) => {
    const src = dataUrlFromImage(img);
    if (!src) return;
    const card = document.createElement("div");
    card.className = "img-card";
    card.innerHTML = `
      <img alt="生成图 ${idx + 1}" />
      <div class="meta">
        <button type="button" data-act="view">查看</button>
        <button type="button" data-act="download">下载</button>
      </div>
    `;
    const imageEl = card.querySelector("img");
    imageEl.src = src;
    imageEl.addEventListener("click", () => openLightbox(sources, idx));
    card.querySelector('[data-act="view"]').addEventListener("click", () => openLightbox(sources, idx));
    card.querySelector('[data-act="download"]').addEventListener("click", () => {
      const stamp = meta?.createdAt ? new Date(meta.createdAt) : new Date();
      const ext = extFromMime(mimeFromImage(img));
      const name = `gptimage2_${stamp.getTime()}_${idx + 1}.${ext}`;
      downloadDataUrl(src, name);
    });
    resultGrid.appendChild(card);
  });
}

function filteredHistory() {
  const q = (historySearch.value || "").trim().toLowerCase();
  const aspect = historyFilterAspect.value;
  const quality = historyFilterQuality.value.toLowerCase();
  return historyCache.filter((item) => {
    if (aspect && item.aspect !== aspect) return false;
    if (quality && String(item.quality || "").toLowerCase() !== quality) return false;
    if (q && !(item.prompt || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderHistory() {
  const list = filteredHistory();
  historyCount.textContent = String(historyCache.length);

  if (!historyCache.length) {
    historyEmpty.classList.remove("hidden");
    historyList.classList.add("hidden");
    historyList.innerHTML = "";
    historyEmpty.querySelector("p").textContent = "还没有历史记录";
    return;
  }

  if (!list.length) {
    historyEmpty.classList.remove("hidden");
    historyList.classList.add("hidden");
    historyList.innerHTML = "";
    historyEmpty.querySelector("p").textContent = "没有匹配的历史记录";
    return;
  }

  historyEmpty.classList.add("hidden");
  historyList.classList.remove("hidden");
  historyList.innerHTML = "";

  list.forEach((item) => {
    const el = document.createElement("article");
    el.className = "history-item";
    el.dataset.id = item.id;

    const sources = (item.images || []).map((img) => dataUrlFromImage(img)).filter(Boolean);
    const thumbs = (item.images || [])
      .map((img, i) => {
        const src = dataUrlFromImage(img);
        return src
          ? `<img src="${src}" alt="历史图 ${i + 1}" data-idx="${i}" />`
          : "";
      })
      .join("");

    el.innerHTML = `
      <div class="history-top">
        <div class="history-meta">
          <span class="pill">${formatTime(item.createdAt)}</span>
          <span class="pill">${item.aspect || "-"}</span>
          <span class="pill">${(item.quality || "-").toString().toUpperCase()}</span>
          <span class="pill">×${item.n || (item.images || []).length || 1}</span>
          ${item.size ? `<span class="pill">${item.size}</span>` : ""}
          ${item.usedReference ? '<span class="pill">参考图</span>' : ""}
        </div>
      </div>
      <p class="history-prompt"></p>
      <div class="history-actions">
        <button type="button" class="ghost" data-act="copy">复制提示词</button>
        <button type="button" class="ghost" data-act="reuse">填回表单</button>
        <button type="button" class="ghost" data-act="download">下载全部</button>
        <button type="button" class="ghost danger" data-act="delete">删除</button>
      </div>
      <div class="history-thumbs">${thumbs}</div>
    `;

    el.querySelector(".history-prompt").textContent = item.prompt || "";

    el.querySelectorAll(".history-thumbs img").forEach((imgEl) => {
      imgEl.addEventListener("click", () => {
        const idx = Number(imgEl.dataset.idx) || 0;
        openLightbox(sources, idx);
      });
    });

    el.querySelector('[data-act="copy"]').addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.prompt || "");
        setStatus("提示词已复制", "ok");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = item.prompt || "";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        setStatus("提示词已复制", "ok");
      }
    });

    el.querySelector('[data-act="reuse"]').addEventListener("click", () => {
      applyParamsToForm(item);
      switchTab("create");
      setStatus("已填回表单，可直接再次生成", "ok");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    el.querySelector('[data-act="download"]').addEventListener("click", () => {
      (item.images || []).forEach((img, idx) => {
        const src = dataUrlFromImage(img);
        if (!src) return;
        const ext = extFromMime(mimeFromImage(img));
        downloadDataUrl(src, `gptimage2_hist_${item.id}_${idx + 1}.${ext}`);
      });
    });

    el.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      try {
        await idbDelete(item.id);
        historyCache = historyCache.filter((x) => x.id !== item.id);
        renderHistory();
      } catch (err) {
        setStatus(err.message || "删除失败", "error");
      }
    });

    historyList.appendChild(el);
  });
}

async function pushHistory(entry) {
  try {
    await idbPut(entry);
    historyCache.unshift(entry);
    await trimHistory();
    renderHistory();
  } catch (err) {
    console.warn(err);
    const msg = String(err?.name || err?.message || "");
    if (/QuotaExceeded|quota/i.test(msg)) {
      // 存储满：删最旧再试一次
      try {
        while (historyCache.length > 3) {
          const old = historyCache.pop();
          if (old?.id) await idbDelete(old.id);
        }
        await idbPut(entry);
        historyCache.unshift(entry);
        await trimHistory();
        renderHistory();
        setStatus("存储空间不足，已自动清理旧历史后保存", "ok");
        return;
      } catch (e2) {
        console.warn(e2);
      }
    }
    setStatus("图片已生成，但历史保存失败（浏览器存储受限）", "error");
  }
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("is-active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
  });
  $("panel-create").classList.toggle("is-active", name === "create");
  $("panel-history").classList.toggle("is-active", name === "history");
}

function setGenerating(isGenerating) {
  submitBtn.disabled = isGenerating;
  submitBtn.classList.toggle("is-loading", isGenerating);
  cancelBtn.classList.toggle("hidden", !isGenerating);
  if (isGenerating) {
    submitBtn.querySelector(".btn-label").textContent = "生成中";
  } else {
    submitBtn.querySelector(".btn-label").textContent = "开始生成";
  }
}

async function runGenerate() {
  setStatus("");

  const password = passwordInput.value.trim();
  const prompt = promptInput.value.trim();
  const aspect = aspectInput.value;
  const quality = qualityInput.value;
  const n = Number(nInput.value) || 1;

  if (!password) {
    setStatus("请填写访问密码", "error");
    return;
  }
  if (!prompt) {
    setStatus("请填写提示词", "error");
    return;
  }
  if (prompt.length > MAX_PROMPT_LEN) {
    setStatus(`提示词过长（最多 ${MAX_PROMPT_LEN} 字）`, "error");
    return;
  }

  savePassword(password);

  lastParams = {
    prompt,
    aspect,
    quality,
    n,
    // 参考图不自动复用文件对象到历史；同参数再生成会沿用当前表单参考图
  };

  const fd = new FormData();
  fd.append("password", password);
  fd.append("prompt", prompt);
  fd.append("aspect", aspect);
  fd.append("quality", quality);
  fd.append("n", String(n));
  if (imageInput.files && imageInput.files[0]) {
    fd.append("image", imageInput.files[0]);
  }

  if (activeAbort) {
    try { activeAbort.abort(); } catch {}
  }
  activeAbort = new AbortController();
  setGenerating(true);

  const slowHint =
    quality === "4k" || n > 1
      ? "（高清/多张较慢，请耐心等待）"
      : "";
  setStatus(`生成中，请稍候…${slowHint}`);

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      body: fd,
      signal: activeAbort.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `请求失败（${res.status}）`);
    }

    const images = Array.isArray(data.images) ? data.images : [];
    if (!images.length) throw new Error("没有返回图片");

    const createdAt = Date.now();
    const meta = {
      createdAt,
      aspect: data.aspect || aspect,
      quality: data.quality || quality,
      size: data.size,
      n: data.n || n,
      usedReference: !!data.used_reference,
      prompt,
    };

    renderCurrentResults(images, meta);
    await pushHistory({
      id: uid(),
      ...meta,
      images: images
        .map((img) => {
          if (img.b64_json) return { b64_json: img.b64_json, mime: img.mime || mimeFromImage(img) };
          if (img.url) return { url: img.url, mime: img.mime };
          return null;
        })
        .filter(Boolean),
    });

    setStatus(`生成成功 · ${images.length} 张${meta.size ? ` · ${meta.size}` : ""}`, "ok");
  } catch (err) {
    if (err?.name === "AbortError") {
      setStatus("已取消生成", "error");
    } else {
      setStatus(err.message || "生成失败", "error");
    }
  } finally {
    activeAbort = null;
    setGenerating(false);
  }
}

// Events
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

bindSeg("[data-aspect]", "aspect", aspectInput);
bindSeg("[data-quality]", "quality", qualityInput);

$("n-dec").addEventListener("click", () => setN(Number(nInput.value) - 1));
$("n-inc").addEventListener("click", () => setN(Number(nInput.value) + 1));

promptInput.addEventListener("input", updatePromptCount);
rememberPassword.addEventListener("change", () => {
  savePassword(passwordInput.value.trim());
});

imageInput.addEventListener("change", updateUploadPreview);
clearImageBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  setImageFile(null);
});

// 拖拽上传
["dragenter", "dragover"].forEach((evt) => {
  uploadZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add("is-dragover");
  });
});
["dragleave", "drop"].forEach((evt) => {
  uploadZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (evt === "dragleave") uploadZone.classList.remove("is-dragover");
  });
});
uploadZone.addEventListener("drop", (e) => {
  uploadZone.classList.remove("is-dragover");
  const file = e.dataTransfer?.files?.[0];
  if (file) setImageFile(file);
});

downloadAllBtn.addEventListener("click", () => {
  currentImages.forEach((img, idx) => {
    const src = dataUrlFromImage(img);
    if (!src) return;
    const stamp = currentMeta?.createdAt || Date.now();
    const ext = extFromMime(mimeFromImage(img));
    downloadDataUrl(src, `gptimage2_${stamp}_${idx + 1}.${ext}`);
  });
});

regenBtn.addEventListener("click", async () => {
  if (!lastParams) return;
  applyParamsToForm(lastParams);
  await runGenerate();
});

cancelBtn.addEventListener("click", () => {
  if (activeAbort) activeAbort.abort();
});

clearHistoryBtn.addEventListener("click", async () => {
  if (!historyCache.length) return;
  if (!confirm("确定清空全部历史记录？此操作不可恢复。")) return;
  try {
    await idbClear();
    historyCache = [];
    renderHistory();
  } catch (err) {
    setStatus(err.message || "清空失败", "error");
  }
});

historySearch.addEventListener("input", renderHistory);
historyFilterAspect.addEventListener("change", renderHistory);
historyFilterQuality.addEventListener("change", renderHistory);

lightboxPrev.addEventListener("click", (e) => {
  e.preventDefault();
  stepLightbox(-1);
});
lightboxNext.addEventListener("click", (e) => {
  e.preventDefault();
  stepLightbox(1);
});

lightbox.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    stepLightbox(-1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    stepLightbox(1);
  } else if (e.key === "Escape") {
    // dialog native close handles Escape
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await runGenerate();
});

(async function init() {
  loadPassword();
  updatePromptCount();
  renderCurrentResults([], null);
  await loadHistory();
  renderHistory();
})();