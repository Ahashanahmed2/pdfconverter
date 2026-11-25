package com.aqis.ocr

import androidx.core.content.FileProvider

// Tauri-র নিজস্ব FileProvider-এর সাথে নামের সংঘাত এড়াতে আলাদা সাবক্লাস
class UpdateFileProvider : FileProvider()
