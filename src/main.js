import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import Tesseract from "tesseract.js";

// ফাইল সিলেক্ট → Rust পাথে রূপান্তর → Tesseract OCR → আউটপুট সংরক্ষণ
async function processImages(paths, outputDir, format, langs) {
  for (const p of paths) {
    const outPath = await invoke("prepare_output", {
      task: { image_path: p, output_dir: outputDir, format }
    });
    const { data: { text } } = await Tesseract.recognize(p, langs);
    await invoke("write_text", { path: outPath, text }); // Rust-এ একটি সহজ write_text কমান্ড যোগ করতে হবে
  }
}

// PDF প্রসেস
async function processPdf(pdfPath, outputDir, format, langs) {
  const imgDir = outputDir + "/" + pdfPath.split("/").pop().replace(".pdf", "");
  const imgPaths = await invoke("pdf_to_images", { pdfPath, outputDir: imgDir });
  for (const img of imgPaths) {
    const outPath = await invoke("prepare_output", {
      task: { image_path: img, output_dir: imgDir, format }
    });
    const { data: { text } } = await Tesseract.recognize(img, langs);
    await invoke("write_text", { path: outPath, text });
  }
}
