// ---- Error capture (সবার আগে) ----
window.addEventListener("error", (e) => {
  const app = document.querySelector("#app");
  if (app) {
    app.innerHTML = `<pre style="padding:16px;color:red;white-space:pre-wrap;font-size:12px;">JS Error:\n${e.message}\n${e.filename}:${e.lineno}</pre>`;
  }
});
window.addEventListener("unhandledrejection", (e) => {
  const app = document.querySelector("#app");
  if (app) {
    app.innerHTML += `<pre style="padding:16px;color:red;white-space:pre-wrap;font-size:12px;">Promise Error:\n${e.reason}</pre>`;
  }
});

// ---- Imports ----
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile as fsWriteFile, remove } from "@tauri-apps/plugin-fs";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { pickFolder, writeTextFile, writeFile } from "tauri-plugin-scoped-storage-api";

const app = document.querySelector("#app");

app.innerHTML = `
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1 style="font-size: 1.5rem; margin: 0 0 4px;">AQIS OCR</h1>
    <p style="color: #64748b; font-size: 0.9rem; margin: 0 0 16px;">PDF ও ছবি থেকে টেক্সট</p>

    <div style="background:#fff; padding:16px; border-radius:12px; margin-bottom:16px;">
      <div style="display:flex; gap:12px; margin-bottom:14px;">
        <div style="flex:1;">
          <label style="font-size:.85rem;font-weight:600;">ফরম্যাট</label>
          <select id="format" style="width:100%; padding:8px; margin-top:4px;">
            <option value="txt">TXT</option>
            <option value="md">Markdown</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <div style="flex:1;">
          <label style="font-size:.85rem;font-weight:600;">ভাষা</label>
          <select id="langs" style="width:100%; padding:8px; margin-top:4px;">
            <option value="eng+ben">English + বাংলা</option>
            <option value="ben">বাংলা</option>
            <option value="eng">English</option>
          </select>
        </div>
      </div>
      <div style="display:flex; gap:10px;">
        <button id="btn-pdf" style="flex:1; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-weight:600;">PDF</button>
        <button id="btn-img" style="flex:1; padding:12px; background:#059669; color:#fff; border:none; border-radius:8px; font-weight:600;">ছবি</button>
      </div>
    </div>

    <div id="progress-box" style="display:none; background:#fff; padding:14px 16px; border-radius:12px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; font-size:.9rem; font-weight:600; margin-bottom:8px;">
        <span id="progress-label">—</span>
        <span id="progress-pct">0%</span>
      </div>
      <div style="height:10px; background:#e2e8f0; border-radius:999px; overflow:hidden;">
        <div id="progress-bar" style="height:100%; width:0%; background:#2563eb; transition:width .25s;"></div>
      </div>
      <div id="progress-sub" style="font-size:.8rem; color:#64748b; margin-top:8px;"></div>
    </div>

    <div style="background:#0f172a; color:#e2e8f0; padding:14px; border-radius:12px;">
      <pre id="status" style="margin:0; white-space:pre-wrap; font-size:.85rem; max-height:280px; overflow-y:auto;">প্রস্তুত।</pre>
    </div>
  </div>
`;

const statusEl = document.querySelector("#status");
const btnPdf = document.querySelector("#btn-pdf");
const btnImg = document.querySelector("#btn-img");
const progressBox = document.querySelector("#progress-box");
const progressLabel = document.querySelector("#progress-label");
const progressPct = document.querySelector("#progress-pct");
const progressBar = document.querySelector("#progress-bar");
const progressSub = document.querySelector("#progress-sub");

function log(msg) {
  statusEl.textContent += `\n${msg}`;
  statusEl.scrollTop = statusEl.scrollHeight;
}

function setBusy(busy) {
  btnPdf.disabled = busy;
  btnImg.disabled = busy;
}

// ---- Progress ----
// done = সম্পন্ন আইটেম সংখ্যা, frac = বর্তমান আইটেমের অগ্রগতি (0..1)
function setProgress(kind, done, total, frac, sub) {
  const pct = Math.min(100, Math.round(((done + frac) / total) * 100));
  const current = Math.min(done + 1, total);
  progressBox.style.display = "block";
  progressLabel.textContent = `${kind} ${current}/${total}`;
  progressPct.textContent = `${pct}%`;
  progressBar.style.width = `${pct}%`;
  progressSub.textContent = sub || "";
}

function finishProgress(kind, total) {
  progressBox.style.display = "block";
  progressLabel.textContent = `${kind} ${total}/${total} সম্পন্ন`;
  progressPct.textContent = "100%";
  progressBar.style.width = "100%";
  progressSub.textContent = "";
}

// content:// URI থেকে ফাইলের নাম (এক্সটেনশন ছাড়া) বের করি
function baseNameOf(p, fallback) {
  let s = p;
  try { s = decodeURIComponent(p); } catch (_) {}
  s = s.split(/[/\\:]/).pop().replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!s || /^\d+$/.test(s)) return fallback;
  return s;
}

function formatOutput(text, format, sourcePath) {
  if (format === "json") return JSON.stringify({ source: sourcePath, text: text.trim() }, null, 2);
  if (format === "md") return `# OCR\n\n**Source:** \`${sourcePath}\`\n\n${text.trim()}`;
  return text;
}

// "best" মডেল (বেশি নির্ভুল, তবে ডাউনলোড বড়)। সমস্যা হলে "" করলে ডিফল্ট মডেল চলবে।
const TESS_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0_best";

// একটাই worker বানাই; logger দিয়ে OCR-এর % আপডেট হয়
// ctx = { kind, index, total, base } — base = OCR শুরুর আগে কত অংশ শেষ (0..1)
async function makeWorker(langs, ctx) {
  const Tesseract = (await import("tesseract.js")).default;
  const opts = {
    logger: (m) => {
      if (m.status === "recognizing text") {
        const frac = ctx.base + (1 - ctx.base) * m.progress;
        setProgress(ctx.kind, ctx.index, ctx.total, frac, "OCR চলছে...");
      }
    },
  };
  if (TESS_LANG_PATH) opts.langPath = TESS_LANG_PATH;
  const worker = await Tesseract.createWorker(langs, 1, opts);
  // টেবিলের কলামের ফাঁক ধরে রাখে
  await worker.setParameters({ preserve_interword_spaces: "1" });
  return worker;
}

// ================= PDF =================
btnPdf.addEventListener("click", async () => {
  let localPdfPath = null;
  let worker = null;
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;

    const folder = await pickFolder();
    if (!folder) return;

    setBusy(true);
    const format = document.querySelector("#format").value;
    const langs = document.querySelector("#langs").value;
    statusEl.textContent = "PDF প্রসেসিং...";
    progressBox.style.display = "none";

    // content:// URI থেকে পড়ে cache-এ কপি
    log("PDF কপি করা হচ্ছে...");
    const pdfBytes = await readFile(selected);
    const cacheDir = await appCacheDir();
    localPdfPath = await join(cacheDir, "input.pdf");
    await fsWriteFile(localPdfPath, pdfBytes);

    log("PDF পেজ সংখ্যা বের করা হচ্ছে...");
    const pageCount = await invoke("get_pdf_page_count", { pdfPath: localPdfPath });
    log(`মোট ${pageCount} পেজ পাওয়া গেছে।`);

    const ctx = { kind: "পেজ", index: 0, total: pageCount, base: 0.1 };
    setProgress("পেজ", 0, pageCount, 0, "OCR ইঞ্জিন লোড হচ্ছে...");
    worker = await makeWorker(langs, ctx);

    // প্রতিটি পেজ: রেন্ডার → ছবি সেভ → OCR → টেক্সট সেভ
    for (let i = 0; i < pageCount; i++) {
      ctx.index = i;

      setProgress("পেজ", i, pageCount, 0, "রেন্ডার হচ্ছে (৫০০ DPI)...");
      // Rust দুটো ফাইল cache-এ লেখে: fullPath (৫০০ DPI), ocrPath (৩০০ DPI)
      const res = await invoke("render_pdf_page", {
        pdfPath: localPdfPath,
        pageIndex: i,
        outDir: cacheDir,
      });

      const imgFileName = `${i + 1}.png`;
      const imgPath = imgFileName;
      setProgress("পেজ", i, pageCount, 0.05, "ছবি সেভ হচ্ছে...");
      let fullBytes = await readFile(res.fullPath);
      await writeFile(folder.id, imgPath, fullBytes, { mimeType: "image/png" });
      fullBytes = null;
      log(`✔ ছবি ${i + 1}/${pageCount} সেভ: ${imgPath}`);

      // OCR (৩০০ DPI কপি; logger % আপডেট করবে)
      let ocrBytes = await readFile(res.ocrPath);
      const { data: { text } } = await worker.recognize(new Blob([ocrBytes], { type: "image/png" }));
      ocrBytes = null;

      // অস্থায়ী ফাইল মুছি
      try { await remove(res.fullPath); } catch (_) {}
      try { await remove(res.ocrPath); } catch (_) {}

      const txtPath = `${i + 1}.${format}`;
      await writeTextFile(folder.id, txtPath, formatOutput(text, format, imgPath));
      log(`✔ টেক্সট ${i + 1}/${pageCount} সেভ: ${txtPath}`);

      setProgress("পেজ", i + 1, pageCount, 0, `${i + 1} পেজ সম্পন্ন`);
    }
    finishProgress("পেজ", pageCount);
    log("🎉 সম্পন্ন!");
    showInterstitialIfDue();
    await maybeShowInterstitial();
  } catch (err) {
    log(`❌ ${err}`);
    console.error(err);
  } finally {
    if (worker) { try { await worker.terminate(); } catch (_) {} }
    if (localPdfPath) { try { await remove(localPdfPath); } catch (_) {} }
    setBusy(false);
  }
});

// ================= ছবি =================
btnImg.addEventListener("click", async () => {
  let worker = null;
  try {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!selected || selected.length === 0) return;

    const folder = await pickFolder();
    if (!folder) return;

    setBusy(true);
    const format = document.querySelector("#format").value;
    const langs = document.querySelector("#langs").value;
    statusEl.textContent = "OCR শুরু...";
    progressBox.style.display = "none";

    const total = selected.length;
    const ctx = { kind: "ছবি", index: 0, total, base: 0.1 };
    setProgress("ছবি", 0, total, 0, "OCR ইঞ্জিন লোড হচ্ছে...");
    worker = await makeWorker(langs, ctx);

    for (let i = 0; i < total; i++) {
      ctx.index = i;
      const imgPath = selected[i];
      const fileName = `${baseNameOf(imgPath, `image_${i + 1}`)}.${format}`;

      setProgress("ছবি", i, total, 0, "ছবি পড়া হচ্ছে...");
      const bytes = await readFile(imgPath);

      const { data: { text } } = await worker.recognize(new Blob([bytes]));

      await writeTextFile(folder.id, fileName, formatOutput(text, format, imgPath));
      log(`✔ ${i + 1}/${total} সেভ: ${fileName}`);

      setProgress("ছবি", i + 1, total, 0, `${i + 1} ছবি সম্পন্ন`);
    }
    finishProgress("ছবি", total);
    log("🎉 সম্পন্ন!");
    showInterstitialIfDue();
    await maybeShowInterstitial();
  } catch (err) {
    log(`❌ ${err}`);
    console.error(err);
  } finally {
    if (worker) { try { await worker.terminate(); } catch (_) {} }
    setBusy(false);
  }
});

// ================= বিজ্ঞাপন (AdMob) =================
// ⚠️ নিচের আইডিগুলো Google-এর টেস্ট আইডি। প্রকাশের আগে নিজের AdMob আইডি বসান।
// টেস্ট আইডি ছাড়া নিজের বিজ্ঞাপনে নিজে ক্লিক করবেন না — অ্যাকাউন্ট বন্ধ হতে পারে।
const ADS = {
  enabled: true,
  bannerId: "ca-app-pub-3940256099942544/9214589741", // টেস্ট: অ্যাডাপ্টিভ ব্যানার
  interstitialId: "ca-app-pub-3940256099942544/1033173712", // টেস্ট: ইন্টারস্টিশিয়াল
  interstitialMinGapMs: 3 * 60 * 1000, // দুই ফুলস্ক্রিন বিজ্ঞাপনের মাঝে ন্যূনতম ৩ মিনিট
};
let lastInterstitialAt = 0;

const adsCall = (cmd, payload = {}) => invoke("ads_call", { cmd, payload });

function addPrivacyLink() {
  if (document.querySelector("#ads-privacy")) return;
  const b = document.createElement("button");
  b.id = "ads-privacy";
  b.textContent = "বিজ্ঞাপন গোপনীয়তা সেটিংস";
  b.style.cssText =
    "display:block; margin:12px auto 0; background:none; border:none; color:#64748b; font-size:.8rem; text-decoration:underline;";
  b.addEventListener("click", () => adsCall("privacyOptions").catch(() => {}));
  document.querySelector("#app > div").appendChild(b);
}

async function initAds() {
  if (!ADS.enabled) return;
  try {
    const r = await adsCall("init");
    if (!r || r.canRequestAds === false) return;

    const b = await adsCall("showBanner", { unitId: ADS.bannerId });
    // ব্যানার যাতে কনটেন্ট ঢেকে না দেয়
    if (b && b.height) document.body.style.paddingBottom = `${Math.ceil(b.height) + 8}px`;

    await adsCall("loadInterstitial", { unitId: ADS.interstitialId });
    if (r.privacyOptionsRequired) addPrivacyLink();
  } catch (err) {
    console.warn("Ads init failed:", err);
  }
}

// কাজ সম্পন্ন হলে (স্বাভাবিক বিরতিতে) ফুলস্ক্রিন বিজ্ঞাপন, ফ্রিকোয়েন্সি সীমা মেনে
async function showInterstitialIfDue() {
  if (!ADS.enabled) return;
  if (Date.now() - lastInterstitialAt < ADS.interstitialMinGapMs) return;
  try {
    const r = await adsCall("showInterstitial");
    if (r && r.shown) lastInterstitialAt = Date.now();
  } catch (err) {
    console.warn("Interstitial failed:", err);
  }
}

// ================= আপডেট চেক =================
// Hugging Face-এর JSON ফাইল: { "app_version": "v1.0.1", "update_notes": "...", "apk_url": "https://..." }
// ঐচ্ছিক: "force": true দিলে "পরে" বাটন থাকবে না।
const UPDATE_JSON_URL = "https://huggingface.co/datasets/ahashanahmed/tafsir/resolve/main/pdfconverter";
const FALLBACK_VERSION = "1.0.0";

function parseVer(v) {
  return String(v).trim().replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const a = parseVer(remote);
  const b = parseVer(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function showUpdateModal(info, currentVer) {
  if (document.querySelector("#update-modal")) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mb = (n) => (n / 1048576).toFixed(1);

  const overlay = document.createElement("div");
  overlay.id = "update-modal";
  overlay.style.cssText =
    "position:fixed; inset:0; background:rgba(15,23,42,.6); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#fff; border-radius:16px; padding:20px; width:100%; max-width:380px; box-shadow:0 10px 40px rgba(0,0,0,.3);";

  const title = document.createElement("div");
  title.textContent = "🔔 নতুন আপডেট এসেছে";
  title.style.cssText = "font-size:1.15rem; font-weight:700; margin-bottom:6px;";

  const ver = document.createElement("div");
  ver.textContent = `বর্তমান: v${String(currentVer).replace(/^v/i, "")}  →  নতুন: v${String(info.app_version).replace(/^v/i, "")}`;
  ver.style.cssText = "font-size:.85rem; color:#64748b; margin-bottom:12px;";

  const notes = document.createElement("div");
  notes.textContent = info.update_notes || "";
  notes.style.cssText =
    "font-size:.95rem; margin-bottom:16px; white-space:pre-wrap; max-height:160px; overflow-y:auto;";

  // ডাউনলোড প্রগ্রেস
  const progWrap = document.createElement("div");
  progWrap.style.cssText = "display:none; margin-bottom:12px;";
  const progTop = document.createElement("div");
  progTop.style.cssText = "display:flex; justify-content:space-between; font-size:.85rem; font-weight:600; margin-bottom:6px;";
  const progLabel = document.createElement("span");
  const progPct = document.createElement("span");
  progTop.append(progLabel, progPct);
  const track = document.createElement("div");
  track.style.cssText = "height:10px; background:#e2e8f0; border-radius:999px; overflow:hidden;";
  const fill = document.createElement("div");
  fill.style.cssText = "height:100%; width:0%; background:#2563eb; transition:width .25s;";
  track.appendChild(fill);
  progWrap.append(progTop, track);

  const msg = document.createElement("div");
  msg.style.cssText = "font-size:.8rem; color:#64748b; margin-bottom:12px; display:none;";
  const setMsg = (text, isError) => {
    msg.style.display = "block";
    msg.style.color = isError ? "#dc2626" : "#64748b";
    msg.textContent = text;
  };

  const row = document.createElement("div");
  row.style.cssText = "display:flex; gap:10px;";

  const btnUpdate = document.createElement("button");
  btnUpdate.textContent = "আপডেট করুন";
  btnUpdate.style.cssText =
    "flex:1; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-weight:600;";
  row.appendChild(btnUpdate);

  const btnBrowser = document.createElement("button");
  btnBrowser.textContent = "ব্রাউজারে ডাউনলোড";
  btnBrowser.style.cssText =
    "display:none; padding:12px; background:#e2e8f0; color:#0f172a; border:none; border-radius:8px; font-weight:600; font-size:.8rem;";
  btnBrowser.addEventListener("click", async () => {
    try { await openUrl(info.apk_url); } catch (e) { setMsg(`❌ ${e}`, true); }
  });
  row.appendChild(btnBrowser);

  if (!info.force) {
    const btnLater = document.createElement("button");
    btnLater.textContent = "পরে";
    btnLater.style.cssText =
      "padding:12px 18px; background:#e2e8f0; color:#0f172a; border:none; border-radius:8px; font-weight:600;";
    btnLater.addEventListener("click", () => overlay.remove());
    row.appendChild(btnLater);
  }

  let downloaded = false; // ডাউনলোড শেষ হলে true

  async function doInstall() {
    const r = await invoke("update_install");
    if (r && r.needsPermission) {
      setMsg("সেটিংসে “এই উৎস থেকে অনুমতি দিন” চালু করে অ্যাপে ফিরে এসে আবার “ইনস্টল করুন” চাপুন।", false);
      btnUpdate.disabled = false;
      btnUpdate.textContent = "ইনস্টল করুন";
      return;
    }
    setMsg("ইনস্টলার খোলা হয়েছে। “ইনস্টল/আপডেট” চাপুন।", false);
    btnUpdate.disabled = false;
    btnUpdate.textContent = "আবার ইনস্টল করুন";
  }

  async function doDownload() {
    if (!/^https:\/\//i.test(info.apk_url)) throw new Error("অবৈধ APK লিংক");
    progWrap.style.display = "block";
    progLabel.textContent = "ডাউনলোড হচ্ছে...";
    progPct.textContent = "0%";
    fill.style.width = "0%";

    await invoke("update_download", { url: info.apk_url });

    // প্রগ্রেস পোলিং
    while (true) {
      const p = await invoke("update_progress");
      if (p.state === "error") throw new Error(p.error || "ডাউনলোড ব্যর্থ");
      if (p.total > 0) {
        const pct = Math.min(100, Math.round((p.downloaded / p.total) * 100));
        fill.style.width = `${pct}%`;
        progPct.textContent = `${pct}%`;
        progLabel.textContent = `${mb(p.downloaded)} / ${mb(p.total)} MB`;
      } else {
        progLabel.textContent = `${mb(p.downloaded)} MB`;
        progPct.textContent = "";
      }
      if (p.state === "done") break;
      await sleep(400);
    }
    fill.style.width = "100%";
    progPct.textContent = "100%";
    progLabel.textContent = "ডাউনলোড সম্পন্ন";
    downloaded = true;
  }

  btnUpdate.addEventListener("click", async () => {
    btnUpdate.disabled = true;
    btnBrowser.style.display = "none";
    msg.style.display = "none";
    try {
      if (!downloaded) {
        btnUpdate.textContent = "ডাউনলোড হচ্ছে...";
        await doDownload();
      }
      btnUpdate.textContent = "ইনস্টল হচ্ছে...";
      await doInstall();
    } catch (err) {
      setMsg(`❌ ${err}`, true);
      btnUpdate.disabled = false;
      btnUpdate.textContent = downloaded ? "আবার চেষ্টা করুন" : "আবার ডাউনলোড";
      btnBrowser.style.display = "block"; // ব্যর্থ হলে ব্রাউজার বিকল্প
    }
  });

  card.append(title, ver, notes, progWrap, msg, row);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

async function checkForUpdate() {
  try {
    let current = FALLBACK_VERSION;
    try { current = await getVersion(); } catch (_) {}

    const res = await fetch(`${UPDATE_JSON_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const info = await res.json();
    if (!info.app_version || !info.apk_url) return;

    if (isNewer(info.app_version, current)) showUpdateModal(info, current);
  } catch (err) {
    // নেটওয়ার্ক না থাকলে চুপচাপ বাদ দিই
    console.warn("Update check failed:", err);
  }
}

log("✅ App ready");
checkForUpdate();
initAds();
