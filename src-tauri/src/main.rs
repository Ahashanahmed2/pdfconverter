use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize, Deserialize)]
struct OcrTask {
    image_path: String,
    output_dir: String,
    format: String, // txt / md / json
}

#[derive(Serialize)]
struct OcrResult {
    source: String,
    output: String,
    success: bool,
    error: Option<String>,
}

// একক ছবি থেকে টেক্সট বের করা (WASM OCR ছবি পড়বে, Rust শুধু পাথ তৈরি করে)
#[tauri::command]
fn prepare_output(task: OcrTask) -> Result<String, String> {
    let img_path = Path::new(&task.image_path);
    let stem = img_path.file_stem().unwrap_or_default().to_string_lossy();
    let out_path = Path::new(&task.output_dir).join(format!("{}.{}", stem, task.format));
    fs::create_dir_all(&task.output_dir).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

// PDF পৃষ্ঠা → PNG (hayro ব্যবহার করে)
#[tauri::command]
async fn pdf_to_images(pdf_path: String, output_dir: String) -> Result<Vec<String>, String> {
    let bytes = fs::read(&pdf_path).map_err(|e| e.to_string())?;
    let pdf = hayro::Pdf::from_bytes(&bytes).map_err(|e| e.to_string())?;
    let mut paths = Vec::new();
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    for (i, page) in pdf.pages().iter().enumerate() {
        let img = page.render(2000, 2000).map_err(|e| e.to_string())?;
        let out_path = Path::new(&output_dir).join(format!("{}.png", i + 1));
        img.save(&out_path).map_err(|e| e.to_string())?;
        paths.push(out_path.to_string_lossy().to_string());
    }
    Ok(paths)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![prepare_output, pdf_to_images])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
