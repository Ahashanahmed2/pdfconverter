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
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

const app = document.querySelector("#app");

// প্রথমে UI দেখাই — Tesseract পরে lazy load
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

    <div style="background:#0f172a; color:#e2e8f0; padding:14px; border-radius:12px;">
      <pre id="status" style="margin:0; white-space:pre-wrap; font-size:.85rem; max-height:280px; overflow-y:auto;">প্রস্তুত।</pre>
    </div>
  </div>
`;

const statusEl = document.querySelector("#status");
const btnPdf = document.querySelector("#btn-pdf");
const btnImg = document.querySelector("#btn-img");

function log(msg) {
  statusEl.textContent += `\n${msg}`;
  statusEl.scrollTop = statusEl.scrollHeight;
}

function setBusy(busy) {
  btnPdf.disabled = busy;
  btnImg.disabled = busy;
}

function formatOutput(text, format, sourcePath) {
  if (format === "json") return JSON.stringify({ source: sourcePath, text: text.trim() }, null, 2);
  if (format === "md") return `# OCR\n\n**Source:** \`${sourcePath}\`\n\n${text.trim()}`;
  return text;
}

async function runOcr(imgPath, outputDir, format, langs) {
  // Tesseract lazy load (শুধু দরকারমতো)
  const Tesseract = (await import("tesseract.js")).default;
  const outPath = await invoke("prepare_output", {
    task: { image_path: imgPath, output_dir: outputDir, format }
  });
  const src = convertFileSrc(imgPath);
  const { data: { text } } = await Tesseract.recognize(src, langs);
  await invoke("write_text", { path: outPath, text: formatOutput(text, format, imgPath) });
  log(`✔ ${outPath}`);
}

btnPdf.addEventListener("click", async () => {
  try {
    const selected = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!selected) return;
    const outDir = await open({ directory: true });
    if (!outDir) return;

    setBusy(true);
    const format = document.querySelector("#format").value;
    const langs = document.querySelector("#langs").value;
    statusEl.textContent = "PDF প্রসেসিং...";

    const baseName = selected.split(/[/\\]/).pop().replace(/\.pdf$/i, "");
    const imgDir = `${outDir}/${baseName}`;
    const imgPaths = await invoke("pdf_to_images", { pdfPath: selected, outputDir: imgDir });
    log(`মোট ${imgPaths.length} পেজ`);
    for (let i = 0; i < imgPaths.length; i++) {
      log(`[${i + 1}/${imgPaths.length}]`);
      await runOcr(imgPaths[i], imgDir, format, langs);
    }
    log("🎉 সম্পন্ন!");
  } catch (err) {
    log(`❌ ${err}`);
  } finally {
    setBusy(false);
  }
});

btnImg.addEventListener("click", async () => {
  try {
    const selected = await open({ multiple: true, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (!selected || selected.length === 0) return;
    const outDir = await open({ directory: true });
    if (!outDir) return;

    setBusy(true);
    const format = document.querySelector("#format").value;
    const langs = document.querySelector("#langs").value;
    statusEl.textContent = "OCR শুরু...";

    for (let i = 0; i < selected.length; i++) {
      log(`[${i + 1}/${selected.length}]`);
      await runOcr(selected[i], outDir, format, langs);
    }
    log("🎉 সম্পন্ন!");
  } catch (err) {
    log(`❌ ${err}`);
  } finally {
    setBusy(false);
  }
});

log("✅ App ready");
