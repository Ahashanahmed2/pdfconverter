use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render, PixmapSettings, RenderCache, RenderSettings};
use base64::{engine::general_purpose, Engine as _};
use std::fs;

// PDF এর প্রতিটি পেজকে PNG base64 স্ট্রিং হিসেবে রিটার্ন করে
#[tauri::command]
async fn pdf_to_images_bytes(pdf_path: String) -> Result<Vec<String>, String> {
    let bytes = fs::read(&pdf_path).map_err(|e| e.to_string())?;
    let pdf = Pdf::new(bytes).map_err(|e| format!("{:?}", e))?;

    let cache = RenderCache::new();
    let interpreter_settings = InterpreterSettings::default();
    let render_settings = RenderSettings::default();
    let pixmap_settings = PixmapSettings::default();

    let mut result = Vec::new();

    for page in pdf.pages().iter() {
        let pixmap = render(
            &page,
            &cache,
            &interpreter_settings,
            &render_settings,
            &pixmap_settings,
        );
        let png_bytes = pixmap
            .into_png()
            .map_err(|e| format!("{:?}", e))?;

        // PNG বাইটকে base64 এ এনকোড করে ফ্রন্টএন্ডে পাঠাই
        result.push(general_purpose::STANDARD.encode(&png_bytes));
    }

    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_scoped_storage::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            pdf_to_images_bytes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
