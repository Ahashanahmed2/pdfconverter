use hayro::{render, InterpreterSettings, PdfData, RenderSettings};
use hayro_interpret::hayro_syntax::Pdf;
use image::{DynamicImage, ImageBuffer, Rgba};
use std::sync::Arc;

#[tauri::command]
async fn pdf_to_images(pdf_path: String, output_dir: String) -> Result<Vec<String>, String> {
    let bytes = fs::read(&pdf_path).map_err(|e| e.to_string())?;
    let data: PdfData = Arc::new(bytes);
    let pdf = Pdf::new(data).map_err(|e| format!("{:?}", e))?;

    let mut paths = Vec::new();
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let interpreter_settings = InterpreterSettings::default();
    let render_settings = RenderSettings::default();

    for (i, page) in pdf.pages().iter().enumerate() {
        let pixmap = render(page, &interpreter_settings, &render_settings);
        let width = pixmap.width() as u32;
        let height = pixmap.height() as u32;
        let rgba_bytes = pixmap.take_u8();

        let img_buf: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(width, height, rgba_bytes)
                .ok_or_else(|| "Failed to create image buffer".to_string())?;

        let out_path = Path::new(&output_dir).join(format!("{}.png", i + 1));
        DynamicImage::ImageRgba8(img_buf)
            .save(&out_path)
            .map_err(|e| e.to_string())?;
        paths.push(out_path.to_string_lossy().to_string());
    }

    Ok(paths)
}
