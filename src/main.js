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
import { pickFolder, writeTextFile, writeFile } from "tauri-plugin-scoped-storage-api";

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

// একক ছবি OCR করে scoped-storage দিয়ে সরাসরি লেখা
async function runOcr(imgPath, folderId, folderPath, format, langs) {
  const Tesseract = (await import("tesseract.js")).default;
  
  const fileName = imgPath.split(/[/\\]/).pop().replace(/\.\w+$/, `.${format}`);
  const src = convertFileSrc(imgPath);
  
  log(`OCR চলছে: ${fileName}`);
  const { data: { text } } = await Tesseract.recognize(src, langs);
  
  const formatted = formatOutput(text, format, imgPath);
  
  // scoped-storage দিয়ে ফাইল লেখা (folder.id এবং relative path)
  await writeTextFile(folderId, `${folderPath}/${fileName}`, formatted);
  log(`✔ সেভ হয়েছে: ${fileName}`);
}

btnPdf.addEventListener("click", async () => {
  try {
    // ১. PDF ফাইল সিলেক্ট (অফিসিয়াল dialog)
    const selected = await open({ 
      multiple: false, 
      filters: [{ name: "PDF", extensions: ["pdf"] }] 
    });
    if (!selected) return;

    // ২. আউটপুট ফোল্ডার সিলেক্ট (scoped-storage - Android এ কাজ করে)
    const folder = await pickFolder();
    if (!folder) return;

    setBusy(true);
    const format = document.querySelector("#format").value;
    const langs = document.querySelector("#langs").value;
    statusEl.textContent = "PDF প্রসেসিং...";

    const baseName = selected.split(/[/\\]/).pop().replace(/\.pdf$/i, "");
    
    // ৩. পেজ সংখ্যা বের করি
    log(`PDF পেজ সংখ্যা বের করা হচ্ছে...`);
    const pageCount = await invoke("get_pdf_page_count", { pdfPath: selected });
    log(`মোট ${pageCount} পেজ পাওয়া গেছে।`);

    const Tesseract = (await import("tesseract.js")).default;

    // ৪. প্রতিটি পেজ একে একে রেন্ডার এবং OCR করি
    for (let i = 0; i < pageCount; i++) {
      log(`[পেজ ${i + 1}/${pageCount}] রেন্ডার হচ্ছে...`);
      
      // Rust থেকে এই পেজের base64 PNG আসবে
      const base64Data = await invoke("render_pdf_page", { pdfPath: selected, pageIndex: i });
      
      const imgFileName = `${i + 1}.png`;
      const imgPath = `${baseName}/${imgFileName}`;
      
      // PNG ফাইল scoped-storage দিয়ে সেভ করি
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let j = 0; j < binaryString.length; j++) {
        bytes[j] = binaryString.charCodeAt(j);
      }
      await writeFile(folder.id, imgPath, bytes, { recursive: true, mimeType: "image/png" });
      log(`✔ ছবি সেভ: ${imgPath}`);

      log(`[পেজ ${i + 1}/${pageCount}] OCR চলছে...`);
      
      // OCR এর জন্য data URL ব্যবহার করি
      const dataUrl = `data:image/png;base64,${base64Data}`;
      const { data: { text } } = await Tesseract.recognize(dataUrl, langs);
      
      const txtName = `${i + 1}.${format}`;
      const txtPath = `${baseName}/${txtName}`;
      const formatted = formatOutput(text, format, `${baseName}/${imgFileName}`);
      await writeTextFile(folder.id, txtPath, formatted);
      log(`✔ টেক্সট সেভ: ${txtPath}`);
    }
    log("🎉 সম্পন্ন!");
  } catch (err) {
    log(`❌ ${err}`);
    console.error(err);
  } finally {
    setBusy(false);
  }
});

btnImg.addEventListener("click", async () => {
  try {
    // ১. ছবি সিলেক্ট (অফিসিয়াল dialog)
    const selected = await open({ 
      multiple: true, 
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }] 
    });
    if (!selected || selected.length === 0) return;

    // ২. আউটপুট ফোল্ডার সিলেক্ট (scoped-storage)
    const folder = await pickFolder();
    if (!folder) return;

    setBusy(true);
    const format = document.querySelector("#format").value;
    const langs = document.querySelector("#langs").value;
    statusEl.textContent = "OCR শুরু...";

    for (let i = 0; i < selected.length; i++) {
      log(`[${i + 1}/${selected.length}]`);
      await runOcr(selected[i], folder.id, "", format, langs);
    }
    log("🎉 সম্পন্ন!");
  } catch (err) {
    log(`❌ ${err}`);
    console.error(err);
  } finally {
    setBusy(false);
  }
});

log("✅ App ready");
