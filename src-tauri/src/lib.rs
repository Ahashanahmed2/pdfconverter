use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{render, PixmapSettings, RenderCache, RenderSettings};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

// ছবির মান (DPI) — সেভ ও OCR দুটোর জন্য একই ছবি
const DPI: f32 = 300.0;
// অস্বাভাবিক বড় পেজে মেমরি বাঁচাতে সর্বোচ্চ দৈর্ঘ্য (পিক্সেল)
const MAX_SIDE_PX: f32 = 12000.0;

// ১. পেজ সংখ্যা জানার জন্য
#[tauri::command]
async fn get_pdf_page_count(pdf_path: String) -> Result<usize, String> {
    let bytes = fs::read(&pdf_path).map_err(|e| e.to_string())?;
    let pdf = Pdf::new(bytes).map_err(|e| format!("{:?}", e))?;
    Ok(pdf.pages().len())
}

// main.js-এর সাথে মিল রাখতে দুটো ফিল্ডই আছে; দুটোর পাথ একই
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderedPage {
    full_path: String,
    ocr_path: String,
}

// ২. একটি পেজ ৩০০ DPI-তে রেন্ডার করে cache ফোল্ডারে ফাইল হিসেবে লেখে।
// base64 আর JS-এ বড় ডেটা পাঠানো হয় না — শুধু পাথ ফেরত যায়।
#[tauri::command]
async fn render_pdf_page(
    pdf_path: String,
    page_index: usize,
    out_dir: String,
) -> Result<RenderedPage, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<RenderedPage, String> {
        let bytes = fs::read(&pdf_path).map_err(|e| e.to_string())?;
        let pdf = Pdf::new(bytes).map_err(|e| format!("{:?}", e))?;

        let page = pdf
            .pages()
            .get(page_index)
            .ok_or_else(|| "Page index out of bounds".to_string())?;

        let (w, h) = page.render_dimensions();

        let mut scale = DPI / 72.0;
        let longest = w.max(h) * scale;
        if longest > MAX_SIDE_PX {
            scale *= MAX_SIDE_PX / longest;
        }

        let cache = RenderCache::new();
        let interpreter_settings = InterpreterSettings::default();
        let render_settings = RenderSettings::default();

        // hayro 0.8: স্কেল ও ব্যাকগ্রাউন্ড PixmapSettings-এ থাকে।
        // bg_color সাদা না দিলে PNG-র পেছনটা স্বচ্ছ (transparent) থাকে।
        let pixmap_settings = PixmapSettings {
            x_scale: scale,
            y_scale: scale,
            bg_color: WHITE,
        };

        let pixmap = render(
            &page,
            &cache,
            &interpreter_settings,
            &render_settings,
            &pixmap_settings,
        );

        let png_bytes = pixmap.into_png().map_err(|e| format!("{:?}", e))?;

        let path = PathBuf::from(&out_dir).join("page.png");
        fs::write(&path, &png_bytes).map_err(|e| e.to_string())?;

        let p = path.to_string_lossy().into_owned();
        Ok(RenderedPage {
            full_path: p.clone(),
            ocr_path: p,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_scoped_storage::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_pdf_page_count,
            render_pdf_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
