use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render, PixmapSettings, RenderCache, RenderSettings};
use base64::{engine::general_purpose, Engine as _};
use std::fs;

// ১. পেজ সংখ্যা জানার জন্য
#[tauri::command]
async fn get_pdf_page_count(pdf_path: String) -> Result<usize, String> {
    let bytes = fs::read(&pdf_path).map_err(|e| e.to_string())?;
    let pdf = Pdf::new(bytes).map_err(|e| format!("{:?}", e))?;
    Ok(pdf.pages().len())
}

// ২. নির্দিষ্ট একটি পেজ রেন্ডার করার জন্য
#[tauri::command]
async fn render_pdf_page(pdf_path: String, page_index: usize) -> Result<String, String> {
    let bytes = fs::read(&pdf_path).map_err(|e| e.to_string())?;
    let pdf = Pdf::new(bytes).map_err(|e| format!("{:?}", e))?;

    let page = pdf.pages().get(page_index)
        .ok_or_else(|| "Page index out of bounds".to_string())?;

    let cache = RenderCache::new();
    let interpreter_settings = InterpreterSettings::default();
    let render_settings = RenderSettings::default();
    let pixmap_settings = PixmapSettings::default();

    let pixmap = render(
        &page,
        &cache,
        &interpreter_settings,
        &render_settings,
        &pixmap_settings,
    );
    
    let png_bytes = pixmap.into_png().map_err(|e| format!("{:?}", e))?;
    
    // PNG কে base64 এ এনকোড করে রিটার্ন করি
    Ok(general_purpose::STANDARD.encode(&png_bytes))
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
