import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import Tesseract from "tesseract.js";

const app = document.querySelector("#app");

window.addEventListener("error", (e) => {
  app.innerHTML = `<pre style="padding:16px;color:red;white-space:pre-wrap;">JS Error: ${e.message}</pre>`;
});
window.addEventListener("unhandledrejection", (e) => {
  app.innerHTML = `<pre style="padding:16px;color:red;white-space:pre-wrap;">Promise Error: ${e.reason}</pre>`;
});

app.innerHTML = `
  <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1 style="font-size: 1.5rem;">AQIS OCR Converter</h1>
    <p style="color: #64748b; font-size: 0.9rem;">PDF ও ছবি থেকে টেক্সট বের করুন</p>

    <div style="background:#fff; padding:16px; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,.1); margin-bottom:16px;">
      <div style="display:flex; gap:12px; margin-bottom:14px;">
        <div style="flex:1;">
          <label>আউটপুট ফরম্যাট</label>
          <select id="format" style="width:100%; padding:8px;">
            <option value="txt">TXT</option>
            <option value="md">Markdown</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <div style="flex:1;">
          <label>ভাষা</label>
          <select id="langs" style="width:100%; padding:8px;">
            <option value="eng+ben">English + বাংলা</option>
            <option value="ben">বাংলা</option>
            <option value="eng">English</option>
          </select>
        </div>
      </div>
      <div style="display:flex; gap:10px;">
        <button id="btn-pdf" style="flex:1; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:8px; cursor:pointer;">PDF সিলেক্ট</button>
        <button id="btn-img" style="flex:1; padding:12px; background:#059669; color:#fff; border:none; border-radius:8px; cursor:pointer;">ছবি সিলেক্ট</button>
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
  if (format === "json") {
    return JSON.stringify({ source: sourcePath, text: text.trim() }, null, 2);
  }
  if (format === "md") {
    return `# OCR Output\n\n**Source:** \`${sourcePath}\`\n\n${text.trim()}`;
  }
  return text;
}

async function runOcrOnImage(imgPath, outputDir, format, langs) {
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
      await runOcrOnImage(imgPaths[i], imgDir, format, langs);
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
      await runOcrOnImage(selected[i], outDir, format, langs);
    }
    log("🎉 সম্পন্ন!");
  } catch (err) {
    log(`❌ ${err}`);
  } finally {
    setBusy(false);
  }
});
