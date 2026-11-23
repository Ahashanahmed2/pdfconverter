import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import Tesseract from "tesseract.js";

const app = document.querySelector("#app");

app.innerHTML = `
  <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1 style="font-size: 1.5rem; margin-bottom: 4px;">AQIS OCR Converter</h1>
    <p style="color: #64748b; font-size: 0.9rem; margin-top: 0; margin-bottom: 20px;">
      PDF ও ছবি থেকে টেক্সট বের করুন
    </p>

    <div style="background: #ffffff; padding: 16px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 16px;">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px;">
        <div style="flex: 1; min-width: 120px;">
          <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">আউটপুট ফরম্যাট</label>
          <select id="format" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.95rem;">
            <option value="txt">TXT (.txt)</option>
            <option value="md">Markdown (.md)</option>
            <option value="json">JSON (.json)</option>
          </select>
        </div>

        <div style="flex: 1; min-width: 120px;">
          <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">ভাষা (Language)</label>
          <select id="langs" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.95rem;">
            <option value="eng+ben">English + বাংলা</option>
            <option value="ben">শুধু বাংলা (ben)</option>
            <option value="eng">শুধু English (eng)</option>
          </select>
        </div>
      </div>

      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button id="btn-pdf" style="flex: 1; padding: 12px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-weight: 600; font-size: 0.95rem; cursor: pointer;">
          PDF সিলেক্ট করুন
        </button>
        <button id="btn-img" style="flex: 1; padding: 12px; background: #059669; color: #fff; border: none; border-radius: 8px; font-weight: 600; font-size: 0.95rem; cursor: pointer;">
          ছবি সিলেক্ট করুন
        </button>
      </div>
    </div>

    <div style="background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 12px;">
      <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">প্রোগ্রেস ও আউটপুট লগ:</div>
      <pre id="status" style="margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 0.85rem; line-height: 1.5; max-height: 280px; overflow-y: auto;">প্রস্তুত। PDF বা ছবি সিলেক্ট করুন...</pre>
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
  btnPdf.style.opacity = busy ? "0.6" : "1";
  btnImg.style.opacity = busy ? "0.6" : "1";
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
  const formatted = formatOutput(text, format, imgPath);

  await invoke("write_text", { path: outPath, text: formatted });
  log(`✔ সেভ হয়েছে: ${outPath}`);
}

async function processImages(paths, outputDir, format, langs) {
  for (let i = 0; i < paths.length; i++) {
    log(`[${i + 1}/${paths.length}] OCR চলছে...`);
    await runOcrOnImage(paths[i], outputDir, format, langs);
  }
}

async function processPdf(pdfPath, outputDir, format, langs) {
  const baseName = pdfPath.split(/[/\\]/).pop().replace(/\.pdf$/i, "");
  const imgDir = `${outputDir}/${baseName}`;

  log(`PDF পেজগুলো ছবিতে রূপান্তর হচ্ছে...`);
  const imgPaths = await invoke("pdf_to_images", {
    pdfPath,
    outputDir: imgDir
  });

  log(`মোট ${imgPaths.length}টি পেজ পাওয়া গেছে।`);
  for (let i = 0; i < imgPaths.length; i++) {
    log(`[পেজ ${i + 1}/${imgPaths.length}] OCR চলছে...`);
    await runOcrOnImage(imgPaths[i], imgDir, format, langs);
  }
}

btnPdf.addEventListener("click", async () => {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    if (!selected) return;

    const outDir = await open({ directory: true });
    if (!outDir) return;

    setBusy(true);
    const format = document.querySelector("#format").value;
    const langs = document.querySelector("#langs").value;
    statusEl.textContent = "PDF প্রসেসিং শুরু হচ্ছে...";

    await processPdf(selected, outDir, format, langs);
    log("🎉 সব কাজ সফলভাবে শেষ হয়েছে!");
  } catch (err) {
    log(`❌ ত্রুটি: ${err}`);
  } finally {
    setBusy(false);
  }
});

btnImg.addEventListener("click", async () => {
  try {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
    });
    if (!selected || selected.length === 0) return;

    const outDir = await open({ directory: true });
    if (!outDir) return;

    setBusy(true);
    const format = document.querySelector("#format").value;
    const langs = document.querySelector("#langs").value;
    statusEl.textContent = "ইমেজ OCR শুরু হচ্ছে...";

    await processImages(selected, outDir, format, langs);
    log("🎉 সব কাজ সফলভাবে শেষ হয়েছে!");
  } catch (err) {
    log(`❌ ত্রুটি: ${err}`);
  } finally {
    setBusy(false);
  }
});
