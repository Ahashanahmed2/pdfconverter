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

// একটাই worker বানাই; logger দিয়ে OCR-এর % আপডেট হয়
// ctx = { kind, index, total, base } — base = OCR শুরুর আগে কত অংশ শেষ (0..1)
async function makeWorker(langs, ctx) {
  const Tesseract = (await import("tesseract.js")).default;
  return Tesseract.createWorker(langs, 1, {
    logger: (m) => {
      if (m.status === "recognizing text") {
        const frac = ctx.base + (1 - ctx.base) * m.progress;
        setProgress(ctx.kind, ctx.index, ctx.total, frac, "OCR চলছে...");
      }
    },
  });
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

      setProgress("পেজ", i, pageCount, 0, "রেন্ডার হচ্ছে...");
      let base64Data = await invoke("render_pdf_page", { pdfPath: localPdfPath, pageIndex: i });

      const binaryString = atob(base64Data);
      base64Data = null;
      let bytes = new Uint8Array(binaryString.length);
      for (let j = 0; j < binaryString.length; j++) {
        bytes[j] = binaryString.charCodeAt(j);
      }

      const imgFileName = `${i + 1}.png`;
      const imgPath = imgFileName;
      setProgress("পেজ", i, pageCount, 0.05, "ছবি সেভ হচ্ছে...");
      await writeFile(folder.id, imgPath, bytes, { mimeType: "image/png" });
      log(`✔ ছবি ${i + 1}/${pageCount} সেভ: ${imgPath}`);

      // OCR (logger % আপডেট করবে)
      const { data: { text } } = await worker.recognize(new Blob([bytes], { type: "image/png" }));
      bytes = null;

      const txtPath = `${i + 1}.${format}`;
      await writeTextFile(folder.id, txtPath, formatOutput(text, format, imgPath));
      log(`✔ টেক্সট ${i + 1}/${pageCount} সেভ: ${txtPath}`);

      setProgress("পেজ", i + 1, pageCount, 0, `${i + 1} পেজ সম্পন্ন`);
    }
    finishProgress("পেজ", pageCount);
    log("🎉 সম্পন্ন!");
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
  } catch (err) {
    log(`❌ ${err}`);
    console.error(err);
  } finally {
    if (worker) { try { await worker.terminate(); } catch (_) {} }
    setBusy(false);
  }
});

log("✅ App ready");

