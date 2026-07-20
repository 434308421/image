const HISTORY_DB = "gptimage2-db";
const HISTORY_STORE = "history";
const HISTORY_KEY_FALLBACK = "gptimage2.history.v1";
const PASSWORD_KEY = "gptimage2.password";
const MAX_HISTORY = 20;
const MAX_N = 4;

const $ = (id) => document.getElementById(id);

const form = $("gen-form");
const passwordInput = $("password");
const promptInput = $("prompt");
const aspectInput = $("aspect");
const qualityInput = $("quality");
const nInput = $("n");
const imageInput = $("image");
const submitBtn = $("submit-btn");
const formStatus = $("form-status");
const resultEmpty = $("result-empty");
const resultGrid = $("result-grid");
const downloadAllBtn = $("download-all");
const historyCount = $("history-count");
const historyEmpty = $("history-empty");
const historyList = $("history-list");
const clearHistoryBtn = $("clear-history");
const previewImg = $("preview-img");
const uploadPreview = $("upload-preview");
const uploadUi = $("upload-ui");
const clearImageBtn = $("clear-image");
const lightbox = $("lightbox");
const lightboxImg = $("lightbox-img");

let currentImages = [];
let currentMeta = null;
let historyCache = [];

function setStatus(text, type = "") {
  formStatus.textContent = text || "";
  formStatus.className = "status" + (type ? ` ${type}` : "");
}

function loadPassword() {
  try {
    const saved = localStorage.getItem(PASSWORD_KEY);
    if (saved) passwordInput.value = saved;
  } catch {}
}

function savePassword(value) {
  try {
    localStorage.setItem(PASSWORD_KEY, value);
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

function dataUrlFromImage(img) {
  if (img.b64_json) {
    const raw = img.b64_json;
    if (raw.startsWith("data:")) return raw;
    return `data:image/png;base64,${raw}`;
  }
  if (img.url) return img.url;
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

function openLightbox(src) {
  lightboxImg.src = src;
  if (typeof lightbox.showModal === "function") lightbox.showModal();
}

function bindSeg(groupSelector, attr, hiddenInput) {
  document.querySelectorAll(groupSelector).forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(groupSelector).forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      hiddenInput.value = btn.dataset[attr];
    });
  });
}

function setN(value) {
  const n = Math.min(MAX_N, Math.max(1, Number(value) || 1));
  nInput.value = String(n);
}

function updateUploadPreview() {
  const file = imageInput.files && imageInput.files[0];
  if (!file) {
    uploadPreview.classList.add("hidden");
    uploadUi.classList.remove("hidden");
    previewImg.removeAttribute("src");
    return;
  }
  const url = URL.createObjectURL(file);
  previewImg.src = url;
  uploadPreview.classList.remove("hidden");
  uploadUi.classList.add("hidden");
}

function renderCurrentResults(images, meta) {
  currentImages = images || [];
  currentMeta = meta || null;

  if (!currentImages.length) {
    resultGrid.classList.add("hidden");
    resultEmpty.classList.remove("hidden");
    downloadAllBtn.disabled = true;
    resultGrid.innerHTML = "";
    return;
  }

  resultEmpty.classList.add("hidden");
  resultGrid.classList.remove("hidden");
  downloadAllBtn.disabled = false;
  resultGrid.innerHTML = "";

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
    imageEl.addEventListener("click", () => openLightbox(src));
    card.querySelector('[data-act="view"]').addEventListener("click", () => openLightbox(src));
    card.querySelector('[data-act="download"]').addEventListener("click", () => {
      const stamp = meta?.createdAt ? new Date(meta.createdAt) : new Date();
      const name = `gptimage2_${stamp.getTime()}_${idx + 1}.png`;
      downloadDataUrl(src, name);
    });
    resultGrid.appendChild(card);
  });
}

function renderHistory() {
  const list = historyCache;
  historyCount.textContent = String(list.length);

  if (!list.length) {
    historyEmpty.classList.remove("hidden");
    historyList.classList.add("hidden");
    historyList.innerHTML = "";
    return;
  }

  historyEmpty.classList.add("hidden");
  historyList.classList.remove("hidden");
  historyList.innerHTML = "";

  list.forEach((item) => {
    const el = document.createElement("article");
    el.className = "history-item";
    el.dataset.id = item.id;

    const thumbs = (item.images || [])
      .map((img, i) => {
        const src = dataUrlFromImage(img);
        return src
          ? `<img src="${src}" alt="历史图 ${i + 1}" data-src="${src}" />`
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
      imgEl.addEventListener("click", () => openLightbox(imgEl.dataset.src));
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
      promptInput.value = item.prompt || "";
      if (item.aspect) {
        aspectInput.value = item.aspect;
        document.querySelectorAll("[data-aspect]").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.aspect === item.aspect);
        });
      }
      if (item.quality) {
        const q = String(item.quality).toLowerCase();
        qualityInput.value = q;
        document.querySelectorAll("[data-quality]").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.quality === q);
        });
      }
      if (item.n) setN(item.n);
      switchTab("create");
      setStatus("已填回表单，可直接再次生成", "ok");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    el.querySelector('[data-act="download"]').addEventListener("click", () => {
      (item.images || []).forEach((img, idx) => {
        const src = dataUrlFromImage(img);
        if (!src) return;
        downloadDataUrl(src, `gptimage2_hist_${item.id}_${idx + 1}.png`);
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
    setStatus("图片已生成，但历史保存失败（浏览器存储受限）", "error");
  }
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("is-active", t.dataset.tab === name);
  });
  $("panel-create").classList.toggle("is-active", name === "create");
  $("panel-history").classList.toggle("is-active", name === "history");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

bindSeg("[data-aspect]", "aspect", aspectInput);
bindSeg("[data-quality]", "quality", qualityInput);

$("n-dec").addEventListener("click", () => setN(Number(nInput.value) - 1));
$("n-inc").addEventListener("click", () => setN(Number(nInput.value) + 1));

imageInput.addEventListener("change", updateUploadPreview);
clearImageBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  imageInput.value = "";
  updateUploadPreview();
});

downloadAllBtn.addEventListener("click", () => {
  currentImages.forEach((img, idx) => {
    const src = dataUrlFromImage(img);
    if (!src) return;
    const stamp = currentMeta?.createdAt || Date.now();
    downloadDataUrl(src, `gptimage2_${stamp}_${idx + 1}.png`);
  });
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
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

  savePassword(password);

  const fd = new FormData();
  fd.append("password", password);
  fd.append("prompt", prompt);
  fd.append("aspect", aspect);
  fd.append("quality", quality);
  fd.append("n", String(n));
  if (imageInput.files && imageInput.files[0]) {
    fd.append("image", imageInput.files[0]);
  }

  submitBtn.disabled = true;
  submitBtn.classList.add("is-loading");
  setStatus("生成中，请稍候…");

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      body: fd,
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
        .map((img) =>
          img.b64_json
            ? { b64_json: img.b64_json }
            : img.url
              ? { url: img.url }
              : null,
        )
        .filter(Boolean),
    });

    setStatus(`生成成功 · ${images.length} 张`, "ok");
  } catch (err) {
    setStatus(err.message || "生成失败", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("is-loading");
  }
});

(async function init() {
  loadPassword();
  renderCurrentResults([], null);
  await loadHistory();
  renderHistory();
})();
