use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render, PixmapSettings, RenderCache, RenderSettings};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize)]
struct OcrTask {
    image_path: String,
    output_dir: String,
    format: String,
}

#[tauri::command]
fn prepare_output(task: OcrTask) -> Result<String, String> {
    let img_path = Path::new(&task.image_path);
    let stem = img_path.file_stem().unwrap_or_default().to_string_lossy();
    let out_path = Path::new(&task.output_dir).join(format!("{}.{}", stem, task.format));
    fs::create_dir_all(&task.output_dir).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
async fn pdf_to_images(pdf_path: String, output_dir: String) -> Result<Vec<String>, String> {
    let bytes = fs::read(&pdf_path).map_err(|e| e.to_string())?;
    let pdf = Pdf::new(bytes).map_err(|e| format!("{:?}", e))?;

    let mut paths = Vec::new();
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let cache = RenderCache::new();
    let interpreter_settings = InterpreterSettings::default();
    let render_settings = RenderSettings::default();
    let pixmap_settings = PixmapSettings::default();

    for (i, page) in pdf.pages().iter().enumerate() {
        let pixmap = render(
            page,
            &cache,
            &interpreter_settings,
            &render_settings,
            &pixmap_settings,
        );
        let png_bytes = pixmap
            .into_png()
            .map_err(|e| format!("{:?}", e))?;

        let out_path = Path::new(&output_dir).join(format!("{}.png", i + 1));
        fs::write(&out_path, png_bytes).map_err(|e| e.to_string())?;
        paths.push(out_path.to_string_lossy().to_string());
    }

    Ok(paths)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            prepare_output,
            write_text,
            pdf_to_images
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
