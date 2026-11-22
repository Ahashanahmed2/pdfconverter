// src-tauri/src/lib.rs

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // আপনার প্লাগিনগুলো এখানে যোগ করুন (যদি থাকে)
        // .plugin(tauri_plugin_some_plugin::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
