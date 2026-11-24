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
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile as fsWriteFile, remove } from "@tauri-apps/plugin-fs";
import { appCacheDir, join } from "@tauri-apps/api/path";
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
