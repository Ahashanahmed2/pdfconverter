// ---- Error capture (first) ----
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
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile as fsWriteFile, remove } from "@tauri-apps/plugin-fs";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { pickFolder, writeTextFile, writeFile } from "tauri-plugin-scoped-storage-api";

const app = document.querySelector("#app");

app.innerHTML = `
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1 style="font-size: 1.5rem; margin: 0 0 4px;">PDF&amp;Image Converter</h1>
    <p style="color: #64748b; font-size: 0.9rem; margin: 0 0 16px;">Extract text from PDF &amp; images, convert image formats</p>

    <div style="background:#fff; padding:16px; border-radius:12px; margin-bottom:16px;">
      <div style="display:flex; flex-wrap:wrap; gap:12px; margin-bottom:14px;">
        <div style="flex:1 1 100%;">
          <label style="font-size:.85rem;font-weight:600;">Format</label>
          <select id="format" style="width:100%; padding:8px; margin-top:4px;">
          </select>
        </div>
        <div style="flex:1 1 100%;">
          <label style="font-size:.85rem;font-weight:600;">Language <span style="font-weight:400;color:#64748b;">(max 3)</span></label>
          <button id="lang-btn" type="button" style="display:block; width:100%; padding:10px; margin-top:4px; text-align:left; border:1px solid #767676; border-radius:4px; background:#fff; color:#0f172a; font-size:1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">—</button>
          <input type="hidden" id="langs" value="eng+ben">
        </div>
      </div>
      <div style="margin-bottom:14px;">
        <label style="font-size:.85rem;font-weight:600;">Image button action</label>
        <select id="img-mode" style="width:100%; padding:8px; margin-top:4px;">
          <option value="ocr">Image to Text (OCR)</option>
          <option value="convert">Image Format Conversion (jpg → png, etc.)</option>
        </select>
      </div>
      <div id="convert-opts" style="display:none; flex-wrap:wrap; gap:12px; margin-bottom:14px;">
        <div style="flex:1 1 100%;">
          <label style="font-size:.85rem;font-weight:600;">New format</label>
          <select id="img-target" style="width:100%; padding:8px; margin-top:4px;"></select>
        </div>
        <div id="quality-wrap" style="flex:1 1 100%; display:none;">
          <label style="font-size:.85rem;font-weight:600;">Quality</label>
          <select id="img-quality" style="width:100%; padding:8px; margin-top:4px;">
            <option value="1">Highest (100%)</option>
            <option value="0.92" selected>Good (92%)</option>
            <option value="0.8">Medium (80%)</option>
            <option value="0.6">Small file (60%)</option>
          </select>
        </div>
      </div>
      <div style="display:flex; gap:10px;">
        <button id="btn-pdf" style="flex:1; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-weight:600;">PDF</button>
        <button id="btn-img" style="flex:1; padding:12px; background:#059669; color:#fff; border:none; border-radius:8px; font-weight:600;">Image</button>
      </div>
    </div>

    <div id="progress-box" style="display:none; background:#fff; padding:14px 16px; border-radius:12px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; font-size:.9rem; font-weight:600; margin-bottom:8px;">
        <span id="progress-label">—</span>
        <span id="progress-pct">0%</span>
      </div>
      <div style="height:10px; background:#e2e8f0; border-radius:999px; overflow:hidden;">
        <div id="progress-bar" style="height:100%; width:0%; background:#2563eb; transition:width .25s;"></div>
      </div>
      <div id="progress-sub" style="font-size:.8rem; color:#64748b; margin-top:8px;"></div>
    </div>

    <div style="background:#0f172a; color:#e2e8f0; padding:14px; border-radius:12px;">
      <pre id="status" style="margin:0; white-space:pre-wrap; font-size:.85rem; max-height:280px; overflow-y:auto;">Ready.</pre>
    </div>
  </div>
`;

const statusEl = document.querySelector("#status");
const btnPdf = document.querySelector("#btn-pdf");
const btnImg = document.querySelector("#btn-img");
const progressBox = document.querySelector("#progress-box");
const progressLabel = document.querySelector("#progress-label");
const progressPct = document.querySelector("#progress-pct");
const progressBar = document.querySelector("#progress-bar");
const progressSub = document.querySelector("#progress-sub");

function log(msg) {
  statusEl.textContent += `\n${msg}`;
  statusEl.scrollTop = statusEl.scrollHeight;
}

function setBusy(busy) {
  btnPdf.disabled = busy;
  btnImg.disabled = busy;
  document.querySelector("#format").disabled = busy;
  document.querySelector("#lang-btn").disabled = busy;
  for (const id of ["#img-mode", "#img-target", "#img-quality"]) document.querySelector(id).disabled = busy;
  // While working: large ad on top; when done: banner at bottom
  if (busy) enterWorkAds(); else leaveWorkAds();
}

// ================= Language selection (all Tesseract languages, max 3 at once) =================
const MAX_LANGS = 3;
// [code, English name, native name]
const LANGUAGES = [
  ["afr", "Afrikaans", "Afrikaans"], ["amh", "Amharic", "አማርኛ"], ["ara", "Arabic", "العربية"],
  ["asm", "Assamese", "অসমীয়া"], ["aze", "Azerbaijani", "Azərbaycan"], ["aze_cyrl", "Azerbaijani (Cyrillic)", ""],
  ["bel", "Belarusian", "Беларуская"], ["ben", "Bengali", ""], ["bod", "Tibetan", "བོད་ཡིག"],
  ["bos", "Bosnian", "Bosanski"], ["bul", "Bulgarian", "Български"], ["cat", "Catalan", "Català"],
  ["ceb", "Cebuano", ""], ["ces", "Czech", "Čeština"], ["chi_sim", "Chinese (Simplified)", "简体中文"],
  ["chi_tra", "Chinese (Traditional)", "繁體中文"], ["chr", "Cherokee", "ᏣᎳᎩ"], ["cym", "Welsh", "Cymraeg"],
  ["dan", "Danish", "Dansk"], ["deu", "German", "Deutsch"], ["dzo", "Dzongkha", "རྫོང་ཁ"],
  ["ell", "Greek", "Ελληνικά"], ["eng", "English", "English"], ["enm", "Middle English", ""],
  ["epo", "Esperanto", ""], ["est", "Estonian", "Eesti"], ["eus", "Basque", "Euskara"],
  ["fas", "Persian", "فارسی"], ["fin", "Finnish", "Suomi"], ["fra", "French", "Français"],
  ["frk", "German (Fraktur)", ""], ["frm", "Middle French", ""], ["gle", "Irish", "Gaeilge"],
  ["glg", "Galician", "Galego"], ["grc", "Ancient Greek", ""], ["guj", "Gujarati", "ગુજરાતી"],
  ["hat", "Haitian Creole", ""], ["heb", "Hebrew", "עברית"], ["hin", "Hindi", "हिन्दी"],
  ["hrv", "Croatian", "Hrvatski"], ["hun", "Hungarian", "Magyar"], ["iku", "Inuktitut", ""],
  ["ind", "Indonesian", "Bahasa Indonesia"], ["isl", "Icelandic", "Íslenska"], ["ita", "Italian", "Italiano"],
  ["ita_old", "Italian (Old)", ""], ["jav", "Javanese", ""], ["jpn", "Japanese", "日本語"],
  ["kan", "Kannada", "ಕನ್ನಡ"], ["kat", "Georgian", "ქართული"], ["kat_old", "Georgian (Old)", ""],
  ["kaz", "Kazakh", "Қазақ"], ["khm", "Khmer", "ខ្មែរ"], ["kir", "Kyrgyz", "Кыргызча"],
  ["kor", "Korean", "한국어"], ["kur", "Kurdish", ""], ["lao", "Lao", "ລາວ"],
  ["lat", "Latin", ""], ["lav", "Latvian", "Latviešu"], ["lit", "Lithuanian", "Lietuvių"],
  ["mal", "Malayalam", "മലയാളം"], ["mar", "Marathi", "मराठी"], ["mkd", "Macedonian", "Македонски"],
  ["mlt", "Maltese", "Malti"], ["msa", "Malay", "Bahasa Melayu"], ["mya", "Burmese", "မြန်မာ"],
  ["nep", "Nepali", "नेपाली"], ["nld", "Dutch", "Nederlands"], ["nor", "Norwegian", "Norsk"],
  ["ori", "Odia", "ଓଡ଼ିଆ"], ["pan", "Punjabi", "ਪੰਜਾਬੀ"], ["pol", "Polish", "Polski"],
  ["por", "Portuguese", "Português"], ["pus", "Pashto", "پښتو"], ["ron", "Romanian", "Română"],
  ["rus", "Russian", "Русский"], ["san", "Sanskrit", "संस्कृतम्"], ["sin", "Sinhala", "සිංහල"],
  ["slk", "Slovak", "Slovenčina"], ["slv", "Slovenian", "Slovenščina"], ["spa", "Spanish", "Español"],
  ["spa_old", "Spanish (Old)", ""], ["sqi", "Albanian", "Shqip"], ["srp", "Serbian", "Српски"],
  ["srp_latn", "Serbian (Latin)", ""], ["swa", "Swahili", "Kiswahili"], ["swe", "Swedish", "Svenska"],
  ["syr", "Syriac", "ܣܘܪܝܝܐ"], ["tam", "Tamil", "தமிழ்"], ["tel", "Telugu", "తెలుగు"],
  ["tgk", "Tajik", "Тоҷикӣ"], ["tgl", "Tagalog", ""], ["tha", "Thai", "ไทย"],
  ["tir", "Tigrinya", "ትግርኛ"], ["tur", "Turkish", "Türkçe"], ["uig", "Uyghur", "ئۇيغۇرچە"],
  ["ukr", "Ukrainian", "Українська"], ["urd", "Urdu", "اردو"], ["uzb", "Uzbek", "Oʻzbek"],
  ["uzb_cyrl", "Uzbek (Cyrillic)", ""], ["vie", "Vietnamese", "Tiếng Việt"], ["yid", "Yiddish", "ייִדיש"],
].map(([code, en, native]) => ({ code, en, native }));

const LANG_MAP = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));
const POPULAR_LANGS = ["ben", "eng", "ara", "hin", "urd"];
const LANG_STORE_KEY = "aqis_langs";

function loadLangs() {
  try {
    const s = JSON.parse(localStorage.getItem(LANG_STORE_KEY) || "null");
    if (Array.isArray(s) && s.length >= 1 && s.length <= MAX_LANGS && s.every((c) => LANG_MAP[c])) return s;
  } catch (_) {}
  return ["eng", "ben"];
}

let selectedLangs = loadLangs();

function langLabel(code) {
  const l = LANG_MAP[code];
  return l.native && l.native !== l.en ? l.native : l.en;
}

function applyLangs() {
  document.querySelector("#langs").value = selectedLangs.join("+");
  document.querySelector("#lang-btn").textContent = selectedLangs.map(langLabel).join(" + ");
  try { localStorage.setItem(LANG_STORE_KEY, JSON.stringify(selectedLangs)); } catch (_) {}
}

function openLangModal() {
  if (document.querySelector("#lang-modal")) return;
  let pick = [...selectedLangs];
  let query = "";

  const overlay = document.createElement("div");
  overlay.id = "lang-modal";
  overlay.style.cssText =
    "position:fixed; inset:0; background:rgba(15,23,42,.6); z-index:9000; display:flex; align-items:center; justify-content:center; padding:16px;";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#fff; border-radius:16px; width:100%; max-width:420px; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 10px 40px rgba(0,0,0,.3);";

  const head = document.createElement("div");
  head.style.cssText = "padding:16px 16px 8px;";
  const title = document.createElement("div");
  title.textContent = `Choose languages (max ${MAX_LANGS})`;
  title.style.cssText = "font-size:1.1rem; font-weight:700; margin-bottom:4px;";
  const hint = document.createElement("div");
  hint.textContent = "If the PDF/image contains multiple languages, select all of them. More languages = slower and more memory.";
  hint.style.cssText = "font-size:.78rem; color:#64748b; margin-bottom:10px;";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search (name or code)";
  search.style.cssText =
    "width:100%; box-sizing:border-box; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:1rem;";
  head.append(title, hint, search);

  const list = document.createElement("div");
  list.style.cssText = "flex:1; overflow-y:auto; padding:0 8px;";

  const foot = document.createElement("div");
  foot.style.cssText = "padding:12px 16px 16px; border-top:1px solid #e2e8f0;";
  const count = document.createElement("div");
  count.style.cssText = "font-size:.85rem; font-weight:600; margin-bottom:10px;";
  const btns = document.createElement("div");
  btns.style.cssText = "display:flex; gap:10px;";
  const btnOk = document.createElement("button");
  btnOk.textContent = "OK";
  btnOk.style.cssText =
    "flex:1; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-weight:600;";
  const btnCancel = document.createElement("button");
  btnCancel.textContent = "Cancel";
  btnCancel.style.cssText =
    "padding:12px 18px; background:#e2e8f0; color:#0f172a; border:none; border-radius:8px; font-weight:600;";
  btns.append(btnOk, btnCancel);
  foot.append(count, btns);

  const ordered = [
    ...POPULAR_LANGS.map((c) => LANG_MAP[c]),
    ...LANGUAGES.filter((l) => !POPULAR_LANGS.includes(l.code)).sort((a, b) => a.en.localeCompare(b.en)),
  ];

  function render() {
    list.textContent = "";
    const q = query.trim().toLowerCase();
    const full = pick.length >= MAX_LANGS;
    for (const l of ordered) {
      if (q && !(l.en.toLowerCase().includes(q) || l.native.toLowerCase().includes(q) || l.code.includes(q))) continue;
      const checked = pick.includes(l.code);
      const row = document.createElement("label");
      const disabled = full && !checked;
      row.style.cssText =
        `display:flex; align-items:center; gap:12px; padding:11px 8px; border-bottom:1px solid #f1f5f9; ${disabled ? "opacity:.4;" : ""}`;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      cb.disabled = disabled;
      cb.style.cssText = "width:20px; height:20px; flex:none;";
      cb.addEventListener("change", () => {
        if (cb.checked) { if (pick.length < MAX_LANGS) pick.push(l.code); }
        else pick = pick.filter((c) => c !== l.code);
        render();
      });
      const name = document.createElement("div");
      name.style.cssText = "flex:1; min-width:0;";
      const main = document.createElement("div");
      main.textContent = l.native && l.native !== l.en ? `${l.native}  ·  ${l.en}` : l.en;
      main.style.cssText = "font-size:.98rem;";
      name.appendChild(main);
      row.append(cb, name);
      list.appendChild(row);
    }
    count.textContent = `Selected: ${pick.length}/${MAX_LANGS}  ${pick.map(langLabel).join(" + ")}`;
    btnOk.disabled = pick.length === 0;
    btnOk.style.opacity = pick.length === 0 ? ".5" : "1";
  }

  search.addEventListener("input", () => { query = search.value; render(); });
  btnCancel.addEventListener("click", () => overlay.remove());
  btnOk.addEventListener("click", () => {
    if (pick.length === 0) return;
    selectedLangs = pick;
    applyLangs();
    overlay.remove();
  });

  card.append(head, list, foot);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  render();
}

document.querySelector("#lang-btn").addEventListener("click", openLangModal);
applyLangs();

// ---- Progress ----
// done = number of completed items, frac = progress of the current item (0..1)
function setProgress(kind, done, total, frac, sub) {
  const pct = Math.min(100, Math.round(((done + frac) / total) * 100));
  const current = Math.min(done + 1, total);
  progressBox.style.display = "block";
  progressLabel.textContent = `${kind} ${current}/${total}`;
  progressPct.textContent = `${pct}%`;
  progressBar.style.width = `${pct}%`;
  progressSub.textContent = sub || "";
}

function finishProgress(kind, total) {
  progressBox.style.display = "block";
  progressLabel.textContent = `${kind} ${total}/${total} done`;
  progressPct.textContent = "100%";
  progressBar.style.width = "100%";
  progressSub.textContent = "";
}

// Get file name (without extension) from a content:// URI
function baseNameOf(p, fallback) {
  let s = p;
  try { s = decodeURIComponent(p); } catch (_) {}
  s = s.split(/[/\\:]/).pop().replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!s || /^\d+$/.test(s)) return fallback;
  return s;
}

// ---------- ZIP (store mode) — for DOCX/ODT, without external libraries ----------
const _enc = new TextEncoder();
const strToU8 = (s) => _enc.encode(s);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: { "name": Uint8Array | [Uint8Array, opts] } — insertion order is the file order
function zipSync(files) {
  const u16 = (v) => [v & 255, (v >>> 8) & 255];
  const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [fileName, val] of Object.entries(files)) {
    const data = Array.isArray(val) ? val[0] : val;
    const name = strToU8(fileName);
    const crc = crc32(data);
    const size = data.length;
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0),
    ]);
    parts.push(local, name, data);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]),
      name
    );
    offset += local.length + name.length + size;
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const count = Object.keys(files).length;
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// ================= Output formats (from Word to every Linux text format) =================
const xmlEsc = (s) =>
  String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

// Split text into paragraphs: blank line = new paragraph, single line break = line break
const toParagraphs = (text) =>
  String(text).replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/).map((p) => p.split("\n").map((l) => l.trimEnd()));

// CSV/TSV cell
const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;

// RTF: characters outside ASCII as \uN?
function rtfEsc(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
    else if (ch === "\n") out += "\\line ";
    else if (c < 32 && ch !== "\t") continue;
    else if (c > 126) out += `\\u${c > 32767 ? c - 65536 : c}?`;
    else out += ch;
  }
  return out;
}

// LaTeX special characters
const texEsc = (s) =>
  String(s)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");

const bodyText = (text) => String(text).replace(/\r\n?/g, "\n").trim();

// id, label, extension, mime, binary?, build(text, source)
const FORMATS = [
  { id: "txt", label: "TXT — Plain Text", ext: "txt", mime: "text/plain",
    build: (t) => bodyText(t) + "\n" },
  { id: "md", label: "Markdown (.md)", ext: "md", mime: "text/markdown",
    build: (t, src) => `# OCR\n\n**Source:** \`${src}\`\n\n${bodyText(t)}\n` },
  { id: "rst", label: "reStructuredText (.rst)", ext: "rst", mime: "text/x-rst",
    build: (t, src) => `OCR\n===\n\n:Source: ${src}\n\n${bodyText(t)}\n` },
  { id: "adoc", label: "AsciiDoc (.adoc)", ext: "adoc", mime: "text/plain",
    build: (t, src) => `= OCR\n:source: ${src}\n\n${bodyText(t)}\n` },
  { id: "org", label: "Org-mode (.org)", ext: "org", mime: "text/plain",
    build: (t, src) => `#+TITLE: OCR\n#+SOURCE: ${src}\n\n${bodyText(t)}\n` },
  { id: "html", label: "HTML (.html)", ext: "html", mime: "text/html",
    build: (t, src) =>
      `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${xmlEsc(src)}</title>\n</head>\n<body>\n` +
      toParagraphs(t).map((p) => `<p dir="auto">${p.map(xmlEsc).join("<br>\n")}</p>`).join("\n") +
      `\n</body>\n</html>\n` },
  { id: "xml", label: "XML (.xml)", ext: "xml", mime: "application/xml",
    build: (t, src) =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<ocr>\n  <source>${xmlEsc(src)}</source>\n  <text>${xmlEsc(bodyText(t))}</text>\n</ocr>\n` },
  { id: "json", label: "JSON (.json)", ext: "json", mime: "application/json",
    build: (t, src) => JSON.stringify({ source: src, text: bodyText(t) }, null, 2) + "\n" },
  { id: "yaml", label: "YAML (.yaml)", ext: "yaml", mime: "text/yaml",
    build: (t, src) =>
      `source: ${JSON.stringify(src)}\ntext: |\n` +
      bodyText(t).split("\n").map((l) => "  " + l).join("\n") + "\n" },
  { id: "csv", label: "CSV (.csv)", ext: "csv", mime: "text/csv",
    build: (t, src) =>
      "\uFEFFsource,line,text\n" +
      bodyText(t).split("\n").map((l, i) => `${csvCell(src)},${i + 1},${csvCell(l)}`).join("\n") + "\n" },
  { id: "tsv", label: "TSV (.tsv)", ext: "tsv", mime: "text/tab-separated-values",
    build: (t, src) =>
      "source\tline\ttext\n" +
      bodyText(t).split("\n").map((l, i) => `${src}\t${i + 1}\t${l.replace(/\t/g, " ")}`).join("\n") + "\n" },
  { id: "tex", label: "LaTeX (.tex, XeLaTeX)", ext: "tex", mime: "application/x-tex",
    build: (t, src) =>
      `% Compile with XeLaTeX or LuaLaTeX (for Unicode/Bengali support)\n` +
      `\\documentclass{article}\n\\usepackage{fontspec}\n\\begin{document}\n` +
      `% Source: ${texEsc(src)}\n` +
      toParagraphs(t).map((p) => p.map(texEsc).join(" \\\\\n")).join("\n\n") +
      `\n\\end{document}\n` },
  { id: "rtf", label: "RTF (.rtf)", ext: "rtf", mime: "application/rtf",
    build: (t) =>
      `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\uc1\\f0\\fs24\n` +
      toParagraphs(t).map((p) => rtfEsc(p.join("\n"))).join("\\par\n\\par\n") + `\n}\n` },
  { id: "docx", label: "MS Word (.docx)", ext: "docx", binary: true,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    build: (t) => {
      const paras = toParagraphs(t)
        .map((p) => {
          const rtl = RTL_RE.test(p.join(""));
          const runs = p
            .map((l) => `<w:t xml:space="preserve">${xmlEsc(l)}</w:t>`)
            .join("<w:br/>");
          return `<w:p>${rtl ? "<w:pPr><w:bidi/></w:pPr>" : ""}<w:r>${rtl ? "<w:rPr><w:rtl/></w:rPr>" : ""}${runs}</w:r></w:p>`;
        })
        .join("");
      const doc =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}` +
        `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>` +
        `</w:body></w:document>`;
      return zipSync({
        "[Content_Types].xml": strToU8(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `</Types>`),
        "_rels/.rels": strToU8(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
          `</Relationships>`),
        "word/document.xml": strToU8(doc),
      });
    } },
  { id: "odt", label: "LibreOffice (.odt)", ext: "odt", binary: true,
    mime: "application/vnd.oasis.opendocument.text",
    build: (t) => {
      const paras = toParagraphs(t)
        .map((p) => `<text:p>${p.map(xmlEsc).join("<text:line-break/>")}</text:p>`)
        .join("");
      const content =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
        `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">` +
        `<office:body><office:text>${paras}</office:text></office:body></office:document-content>`;
      const mt = "application/vnd.oasis.opendocument.text";
      return zipSync({
        // mimetype must be the first entry and uncompressed
        "mimetype": [strToU8(mt), { level: 0 }],
        "META-INF/manifest.xml": strToU8(
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">` +
          `<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${mt}"/>` +
          `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
          `</manifest:manifest>`),
        "content.xml": strToU8(content),
      });
    } },
  // Old Word .doc format: actually RTF, which Word opens directly
  { id: "doc", label: "MS Word 97-2003 (.doc, RTF-based)", ext: "doc", mime: "application/msword",
    build: (t, s) => FORMAT_MAP.rtf.build(t, s) },
  { id: "log", label: "LOG (.log)", ext: "log", mime: "text/plain",
    build: (t, s) => `# ${s}\n${bodyText(t)}\n` },
  { id: "man", label: "Linux man page (.man)", ext: "man", mime: "text/troff",
    build: (t, s) =>
      `.TH OCR 1 "" "" "${String(s).replace(/["\\]/g, "")}"\n.SH TEXT\n.nf\n` +
      bodyText(t).split("\n").map((l) => l.replace(/\\/g, "\\e").replace(/^([.'])/, "\\&$1")).join("\n") +
      "\n.fi\n" },
];
const FORMAT_MAP = Object.fromEntries(FORMATS.map((f) => [f.id, f]));

// Fill the format list
(function fillFormats() {
  const sel = document.querySelector("#format");
  for (const f of FORMATS) {
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = f.label;
    sel.appendChild(o);
  }
  try {
    const saved = localStorage.getItem("aqis_format");
    if (saved && FORMAT_MAP[saved]) sel.value = saved;
  } catch (_) {}
  sel.addEventListener("change", () => {
    try { localStorage.setItem("aqis_format", sel.value); } catch (_) {}
  });
})();

// Display name of a file (with extension), from a content:// URI
function displayName(p) {
  let s = String(p);
  try { s = decodeURIComponent(s); } catch (_) {}
  return s.split(/[/\\:]/).pop() || s;
}

// Android SAF: when the extension doesn't match a known mime, an extra extension gets appended to the name
// (e.g. "1.adoc.txt"). So only matching formats use the real mime, others use octet-stream.
const SAFE_MIME_EXT = new Set(["txt", "html", "xml", "json", "csv", "docx", "odt"]);

// Create and save the output file; returns the saved file name
async function saveOutput(folderId, baseName, text, formatId, source) {
  const f = FORMAT_MAP[formatId] || FORMAT_MAP.txt;
  const name = `${baseName}.${f.ext}`;
  const data = f.build(text, displayName(source));
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const mimeType = SAFE_MIME_EXT.has(f.ext) ? f.mime : "application/octet-stream";
  const opts = { mimeType };
  if (name.includes("/")) opts.recursive = true; // create subfolders if missing
  await writeFile(folderId, name, bytes, opts);
  return name;
}

// "best" model (more accurate, but larger download). If there are issues, set "" to use the default model.
const TESS_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0_best";

// Create a single worker; the logger updates OCR %
// ctx = { kind, index, total, base } — base = fraction completed before OCR starts (0..1)
async function makeWorker(langs, ctx) {
  const Tesseract = (await import("tesseract.js")).default;
  const opts = {
    logger: (m) => {
      if (m.status === "recognizing text") {
        const frac = ctx.base + (1 - ctx.base) * m.progress;
        setProgress(ctx.kind, ctx.index, ctx.total, frac, "OCR running...");
      }
    },
  };
  if (TESS_LANG_PATH) opts.langPath = TESS_LANG_PATH;
  const worker = await Tesseract.createWorker(langs, 1, opts);
  // Preserve gaps between table columns
  await worker.setParameters({ preserve_interword_spaces: "1" });
  return worker;
}

// ================= PDF =================
btnPdf.addEventListener("click", async () => {
  let localPdfPath = null;
  let worker = null;
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;

    const folder = await pickFolder();
    if (!folder) return;

    setBusy(true);
    const format = document.querySelector("#format").value;
    const langs = document.querySelector("#langs").value;
    statusEl.textContent = "Processing PDF...";
    progressBox.style.display = "none";

    // Read from content:// URI and copy to cache
    log("Copying PDF...");
    const pdfBytes = await readFile(selected);
    const cacheDir = await appCacheDir();
    localPdfPath = await join(cacheDir, "input.pdf");
    await fsWriteFile(localPdfPath, pdfBytes);

    log("Counting PDF pages...");
    const pageCount = await invoke("get_pdf_page_count", { pdfPath: localPdfPath });
    log(`Found ${pageCount} pages.`);

    // Output folders: pdfname_image (images) and pdfname_text (text)
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const pdfBase = baseNameOf(selected, `pdf_${stamp}`);
    const imageDir = `${pdfBase}_image`;
    const textDir = `${pdfBase}_text`;
    log(`Folders: ${imageDir}, ${textDir}`);

    const ctx = { kind: "Page", index: 0, total: pageCount, base: 0.1 };
    setProgress("Page", 0, pageCount, 0, "Loading OCR engine...");
    worker = await makeWorker(langs, ctx);

    // Each page: render → save image → OCR → save text
    for (let i = 0; i < pageCount; i++) {
      ctx.index = i;

      setProgress("Page", i, pageCount, 0, "Rendering (300 DPI)...");
      // Rust writes two files to cache: fullPath (500 DPI), ocrPath (300 DPI)
      const res = await invoke("render_pdf_page", {
        pdfPath: localPdfPath,
        pageIndex: i,
        outDir: cacheDir,
      });

      const imgPath = `${imageDir}/${i + 1}.png`;
      setProgress("Page", i, pageCount, 0.05, "Saving image...");
      let fullBytes = await readFile(res.fullPath);
      await writeFile(folder.id, imgPath, fullBytes, { mimeType: "image/png", recursive: true });
      fullBytes = null;
      log(`✔ Image ${i + 1}/${pageCount} saved: ${imgPath}`);

      // OCR (300 DPI copy; logger updates %)
      let ocrBytes = await readFile(res.ocrPath);
      const { data: { text } } = await worker.recognize(new Blob([ocrBytes], { type: "image/png" }));
      ocrBytes = null;

      // Delete temp files
      try { await remove(res.fullPath); } catch (_) {}
      try { await remove(res.ocrPath); } catch (_) {}

      const txtPath = await saveOutput(folder.id, `${textDir}/${i + 1}`, text, format, imgPath);
      log(`✔ Text ${i + 1}/${pageCount} saved: ${txtPath}`);

      setProgress("Page", i + 1, pageCount, 0, `${i + 1} page(s) done`);
    }
    finishProgress("Page", pageCount);
    log("🎉 Done!");
    showInterstitialIfDue();
  } catch (err) {
    log(`❌ ${err}`);
    console.error(err);
  } finally {
    if (worker) { try { await worker.terminate(); } catch (_) {} }
    if (localPdfPath) { try { await remove(localPdfPath); } catch (_) {} }
    setBusy(false);
  }
});

// ================= Image =================
// ================= Image → Image (format conversion) =================
// PNG/JPG/WebP via the WebView canvas; BMP, TIFF, ICO, PDF via custom encoders.
// (No GIF or AVIF: the Android WebView canvas cannot encode them.)
const IMG_FORMATS = {
  png:  { label: "PNG (best quality, keeps transparency)", ext: "png",  mime: "image/png",  quality: false },
  jpg:  { label: "JPG (small file, transparency becomes white)", ext: "jpg", mime: "image/jpeg", quality: true },
  webp: { label: "WebP (small file, keeps transparency)", ext: "webp", mime: "image/webp", quality: true },
  bmp:  { label: "BMP (uncompressed)", ext: "bmp", mime: "image/bmp", quality: false },
  ico:  { label: "ICO (icon, 256×256)", ext: "ico", mime: "image/x-icon", quality: false },
  tiff: { label: "TIFF (uncompressed, large file)", ext: "tiff", mime: "image/tiff", quality: false },
  pdf:  { label: "PDF (image on A4 page)", ext: "pdf", mime: "application/pdf", quality: true },
};
const MAX_CONVERT_PIXELS = 40_000_000; // Memory risk above 40 megapixels

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), type, quality)
  );
}
const blobBytes = async (b) => new Uint8Array(await b.arrayBuffer());

// bytes → image source (ImageBitmap or <img>)
async function decodeImage(bytes) {
  const blob = new Blob([bytes]);
  try {
    return await createImageBitmap(blob);
  } catch (_) {
    // Older WebView: try via <img>
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch (e) {
      throw new Error("Cannot read this image format (HEIC/TIFF etc. not supported)");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
const srcSize = (s) => ({ w: s.naturalWidth || s.width, h: s.naturalHeight || s.height });

// ---------- BMP (24-bit, bottom-up) ----------
function encodeBmp(canvas) {
  const w = canvas.width, h = canvas.height;
  const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const row = (w * 3 + 3) & ~3;
  const size = 54 + row * h;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  dv.setUint32(2, size, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, row * h, true);
  dv.setInt32(38, 2835, true);
  dv.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let s = (h - 1 - y) * w * 4;
    let o = 54 + y * row;
    for (let x = 0; x < w; x++, s += 4) {
      out[o++] = px[s + 2];
      out[o++] = px[s + 1];
      out[o++] = px[s];
    }
  }
  return out;
}

// ---------- TIFF (uncompressed RGB, 8-bit) ----------
function encodeTiff(canvas) {
  const w = canvas.width, h = canvas.height;
  const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const n = 10;
  const ifdOff = 8;
  const ifdSize = 2 + n * 12 + 4;
  const bpsOff = ifdOff + ifdSize;
  const dataOff = bpsOff + 6;
  const pixels = w * h * 3;
  const out = new Uint8Array(dataOff + pixels);
  const dv = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOff, true);
  dv.setUint16(ifdOff, n, true);
  const SHORT = 3, LONG = 4;
  const entries = [
    [256, LONG, w], [257, LONG, h], [258, SHORT, bpsOff, 3], [259, SHORT, 1], [262, SHORT, 2],
    [273, LONG, dataOff], [277, SHORT, 3], [278, LONG, h], [279, LONG, pixels], [284, SHORT, 1],
  ];
  entries.forEach(([tag, type, value, count = 1], i) => {
    const o = ifdOff + 2 + i * 12;
    dv.setUint16(o, tag, true);
    dv.setUint16(o + 2, type, true);
    dv.setUint32(o + 4, count, true);
    if (type === SHORT && count === 1) dv.setUint16(o + 8, value, true);
    else dv.setUint32(o + 8, value, true);
  });
  dv.setUint32(ifdOff + 2 + n * 12, 0, true); // no next IFD
  dv.setUint16(bpsOff, 8, true); dv.setUint16(bpsOff + 2, 8, true); dv.setUint16(bpsOff + 4, 8, true);
  let o = dataOff;
  for (let s = 0; s < px.length; s += 4) {
    out[o++] = px[s]; out[o++] = px[s + 1]; out[o++] = px[s + 2];
  }
  return out;
}

// ---------- ICO (embedded PNG, single 256×256 entry) ----------
function encodeIco(pngBytes) {
  const out = new Uint8Array(22 + pngBytes.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true);   // type = icon
  dv.setUint16(4, 1, true);   // 1 image
  out[6] = 0; out[7] = 0;     // 0 means 256
  dv.setUint16(10, 1, true);  // planes
  dv.setUint16(12, 32, true); // bits
  dv.setUint32(14, pngBytes.length, true);
  dv.setUint32(18, 22, true);
  out.set(pngBytes, 22);
  return out;
}

// ---------- PDF (image on A4 page, embedded JPEG) ----------
function encodePdfFromJpeg(jpeg, wpx, hpx) {
  const te = new TextEncoder();
  let pw = 595.28, ph = 841.89;
  if (wpx > hpx) [pw, ph] = [ph, pw];
  const margin = 20;
  const s = Math.min((pw - 2 * margin) / wpx, (ph - 2 * margin) / hpx);
  const dw = wpx * s, dh = hpx * s;
  const x = (pw - dw) / 2, y = (ph - dh) / 2;
  const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;

  const chunks = [];
  const offs = [];
  let len = 0;
  const push = (b) => { const u = typeof b === "string" ? te.encode(b) : b; chunks.push(u); len += u.length; };
  const obj = (n, fn) => { offs[n] = len; push(`${n} 0 obj\n`); fn(); push("endobj\n"); };

  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>\n"));
  obj(2, () => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n"));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\n`));
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${wpx} /Height ${hpx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push("\nendstream\n");
  });
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\n`));

  const xref = len;
  let table = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) table += `${String(offs[i]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

// Main conversion: bytes → bytes in the target format
async function convertImage(bytes, target, quality) {
  const f = IMG_FORMATS[target];
  if (!f) throw new Error("Unknown format");
  const src = await decodeImage(bytes);
  try {
    const { w, h } = srcSize(src);
    if (!w || !h) throw new Error("Could not get image dimensions");
    if (w * h > MAX_CONVERT_PIXELS) throw new Error(`Image too large (${w}×${h})`);

    if (target === "ico") {
      const c = makeCanvas(256, 256); // transparent, image centered
      const s = Math.min(256 / w, 256 / h);
      const dw = Math.round(w * s), dh = Math.round(h * s);
      c.getContext("2d").drawImage(src, (256 - dw) / 2, (256 - dh) / 2, dw, dh);
      return encodeIco(await blobBytes(await canvasBlob(c, "image/png")));
    }

    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d");
    // JPG/BMP/TIFF/PDF have no transparency; without a white background it becomes black
    if (!["png", "webp"].includes(target)) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(src, 0, 0);

    if (target === "png") return blobBytes(await canvasBlob(canvas, "image/png"));
    if (target === "jpg") return blobBytes(await canvasBlob(canvas, "image/jpeg", quality));
    if (target === "webp") {
      const b = await canvasBlob(canvas, "image/webp", quality);
      if (b.type !== "image/webp") throw new Error("WebP is not supported on this device");
      return blobBytes(b);
    }
    if (target === "bmp") return encodeBmp(canvas);
    if (target === "tiff") return encodeTiff(canvas);
    if (target === "pdf") {
      const jpeg = await blobBytes(await canvasBlob(canvas, "image/jpeg", quality));
      return encodePdfFromJpeg(jpeg, w, h);
    }
    throw new Error("Unknown format");
  } finally {
    if (src && typeof src.close === "function") src.close();
  }
}

// ---- Image button mode and conversion settings ----
const imgModeEl = document.querySelector("#img-mode");
const imgTargetEl = document.querySelector("#img-target");
const imgQualityEl = document.querySelector("#img-quality");

for (const [id, f] of Object.entries(IMG_FORMATS)) {
  const o = document.createElement("option");
  o.value = id;
  o.textContent = f.label;
  imgTargetEl.appendChild(o);
}

function prefGet(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null && allowed.includes(v)) return v;
  } catch (_) {}
  return fallback;
}
imgModeEl.value = prefGet("aqis_img_mode", "ocr", ["ocr", "convert"]);
imgTargetEl.value = prefGet("aqis_img_target", "png", Object.keys(IMG_FORMATS));
imgQualityEl.value = prefGet("aqis_img_quality", "0.92", ["1", "0.92", "0.8", "0.6"]);

function applyImgMode() {
  const convert = imgModeEl.value === "convert";
  document.querySelector("#convert-opts").style.display = convert ? "flex" : "none";
  document.querySelector("#quality-wrap").style.display = IMG_FORMATS[imgTargetEl.value].quality ? "block" : "none";
  btnImg.textContent = convert ? "Image → Image" : "Image → Text";
  try {
    localStorage.setItem("aqis_img_mode", imgModeEl.value);
    localStorage.setItem("aqis_img_target", imgTargetEl.value);
    localStorage.setItem("aqis_img_quality", imgQualityEl.value);
  } catch (_) {}
}
for (const el of [imgModeEl, imgTargetEl, imgQualityEl]) el.addEventListener("change", applyImgMode);
applyImgMode();

// Image → Image: convert one by one, saving each result immediately
async function convertImages() {
  try {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "avif"] }],
    });
    if (!selected || selected.length === 0) return;

    const folder = await pickFolder();
    if (!folder) return;

    setBusy(true);
    const target = imgTargetEl.value;
    const f = IMG_FORMATS[target];
    const quality = parseFloat(imgQualityEl.value) || 0.92;
    statusEl.textContent = `Starting image conversion (${f.ext.toUpperCase()})...`;
    progressBox.style.display = "none";

    const total = selected.length;
    let ok = 0;
    for (let i = 0; i < total; i++) {
      const imgPath = selected[i];
      const outName = `${baseNameOf(imgPath, `image_${i + 1}`)}.${f.ext}`;
      try {
        setProgress("Image", i, total, 0, "Reading image...");
        const bytes = await readFile(imgPath);

        setProgress("Image", i, total, 0.3, "Converting...");
        const out = await convertImage(bytes, target, quality);

        setProgress("Image", i, total, 0.8, "Saving...");
        await writeFile(folder.id, outName, out, { mimeType: f.mime });
        log(`✔ ${i + 1}/${total} saved: ${outName}`);
        ok++;
      } catch (err) {
        // If one image fails, the rest continue
        log(`❌ ${i + 1}/${total} ${displayName(imgPath)}: ${err}`);
      }
      setProgress("Image", i + 1, total, 0, `${i + 1} image(s) done`);
    }
    finishProgress("Image", total);
    log(`🎉 Done! ${ok}/${total} images converted.`);
    if (ok > 0) showInterstitialIfDue();
  } catch (err) {
    log(`❌ ${err}`);
    console.error(err);
  } finally {
    setBusy(false);
  }
}

btnImg.addEventListener("click", async () => {
  if (imgModeEl.value === "convert") { await convertImages(); return; }
  let worker = null;
  try {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!selected || selected.length === 0) return;

    const folder = await pickFolder();
    if (!folder) return;

    setBusy(true);
    const format = document.querySelector("#format").value;
    const langs = document.querySelector("#langs").value;
    statusEl.textContent = "Starting OCR...";
    progressBox.style.display = "none";

    const total = selected.length;
    const ctx = { kind: "Image", index: 0, total, base: 0.1 };
    setProgress("Image", 0, total, 0, "Loading OCR engine...");
    worker = await makeWorker(langs, ctx);

    for (let i = 0; i < total; i++) {
      ctx.index = i;
      const imgPath = selected[i];
      const outBase = baseNameOf(imgPath, `image_${i + 1}`);

      setProgress("Image", i, total, 0, "Reading image...");
      const bytes = await readFile(imgPath);

      const { data: { text } } = await worker.recognize(new Blob([bytes]));

      const fileName = await saveOutput(folder.id, outBase, text, format, imgPath);
      log(`✔ ${i + 1}/${total} saved: ${fileName}`);

      setProgress("Image", i + 1, total, 0, `${i + 1} image(s) done`);
    }
    finishProgress("Image", total);
    log("🎉 Done!");
    showInterstitialIfDue();
  } catch (err) {
    log(`❌ ${err}`);
    console.error(err);
  } finally {
    if (worker) { try { await worker.terminate(); } catch (_) {} }
    setBusy(false);
  }
});

// ================= Ads (AdMob) =================
// ⚠️ The IDs below are Google test IDs. Replace with your own AdMob IDs before publishing.
// Never click your own ads outside test IDs — your account may be suspended.
const ADS = {
  enabled: true,
  bannerId: "ca-app-pub-3940256099942544/9214589741", // Test: adaptive banner
  // Test: the banner ID serves 300×250. For a real release, create a separate "Banner" ad unit in AdMob.
  mrecId: "ca-app-pub-3940256099942544/6300978111",
  interstitialId: "ca-app-pub-3940256099942544/1033173712", // Test: interstitial
  interstitialMinGapMs: 3 * 60 * 1000, // minimum 3 minutes between two fullscreen ads
};
let lastInterstitialAt = 0;

const adsCall = (cmd, payload = {}) => invoke("ads_call", { cmd, payload });

let adsReady = false;
let adsChain = Promise.resolve(); // so ad calls run one after another
const queueAds = (fn) => {
  adsChain = adsChain.then(fn).catch((e) => console.warn("Ads:", e));
  return adsChain;
};

// Work start: remove the bottom banner and show a 300×250 ad on top
function enterWorkAds() {
  if (!ADS.enabled || !adsReady) return;
  queueAds(async () => {
    await adsCall("hideBanner");
    document.body.style.paddingBottom = "";
    const r = await adsCall("showMrec", { unitId: ADS.mrecId });
    if (r && r.height) {
      document.body.style.paddingTop = `${Math.ceil(r.height + (r.topInset || 0)) + 8}px`;
    }
  });
}

// Work end: remove the top ad and restore the bottom banner
function leaveWorkAds() {
  if (!ADS.enabled || !adsReady) return;
  queueAds(async () => {
    await adsCall("hideMrec");
    document.body.style.paddingTop = "";
    const b = await adsCall("showBanner", { unitId: ADS.bannerId });
    if (b && b.height) document.body.style.paddingBottom = `${Math.ceil(b.height) + 8}px`;
  });
}


function addPrivacyLink() {
  if (document.querySelector("#ads-privacy")) return;
  const b = document.createElement("button");
  b.id = "ads-privacy";
  b.textContent = "Ad privacy settings";
  b.style.cssText =
    "display:block; margin:12px auto 0; background:none; border:none; color:#64748b; font-size:.8rem; text-decoration:underline;";
  b.addEventListener("click", () => adsCall("privacyOptions").catch(() => {}));
  document.querySelector("#app > div").appendChild(b);
}

async function initAds() {
  if (!ADS.enabled) return;
  try {
    const r = await adsCall("init");
    if (!r || r.canRequestAds === false) return;
    adsReady = true;

    const b = await adsCall("showBanner", { unitId: ADS.bannerId });
    // so the banner doesn't cover content
    if (b && b.height) document.body.style.paddingBottom = `${Math.ceil(b.height) + 8}px`;

    await adsCall("loadInterstitial", { unitId: ADS.interstitialId });
    if (r.privacyOptionsRequired) addPrivacyLink();
  } catch (err) {
    console.warn("Ads init failed:", err);
  }
}

// Show a fullscreen ad after work completes (with normal pacing), respecting the frequency cap
async function showInterstitialIfDue() {
  if (!ADS.enabled) return;
  if (Date.now() - lastInterstitialAt < ADS.interstitialMinGapMs) return;
  try {
    const r = await adsCall("showInterstitial");
    if (r && r.shown) lastInterstitialAt = Date.now();
  } catch (err) {
    console.warn("Interstitial failed:", err);
  }
}

// ================= Update check =================
// Hugging Face JSON file: { "app_version": "v1.0.1", "update_notes": "...", "apk_url": "https://..." }
// Optional: with "force": true the "Later" button is hidden.
const UPDATE_JSON_URL = "https://huggingface.co/datasets/ahashanahmed/tafsir/resolve/main/pdfconverter";
const FALLBACK_VERSION = "1.0.0";

function parseVer(v) {
  return String(v).trim().replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const a = parseVer(remote);
  const b = parseVer(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function showUpdateModal(info, currentVer) {
  if (document.querySelector("#update-modal")) return;

  const mb = (n) => (n / 1048576).toFixed(1);

  const overlay = document.createElement("div");
  overlay.id = "update-modal";
  overlay.style.cssText =
    "position:fixed; inset:0; background:rgba(15,23,42,.6); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#fff; border-radius:16px; padding:20px; width:100%; max-width:380px; box-shadow:0 10px 40px rgba(0,0,0,.3);";

  const title = document.createElement("div");
  title.textContent = "🔔 New update available";
  title.style.cssText = "font-size:1.15rem; font-weight:700; margin-bottom:6px;";

  const ver = document.createElement("div");
  ver.textContent = `Current: v${String(currentVer).replace(/^v/i, "")}  →  New: v${String(info.app_version).replace(/^v/i, "")}`;
  ver.style.cssText = "font-size:.85rem; color:#64748b; margin-bottom:12px;";

  const notes = document.createElement("div");
  notes.textContent = info.update_notes || "";
  notes.style.cssText =
    "font-size:.95rem; margin-bottom:16px; white-space:pre-wrap; max-height:160px; overflow-y:auto;";

  // Download progress
  const progWrap = document.createElement("div");
  progWrap.style.cssText = "display:none; margin-bottom:12px;";
  const progTop = document.createElement("div");
  progTop.style.cssText = "display:flex; justify-content:space-between; font-size:.85rem; font-weight:600; margin-bottom:6px;";
  const progLabel = document.createElement("span");
  const progPct = document.createElement("span");
  progTop.append(progLabel, progPct);
  const track = document.createElement("div");
  track.style.cssText = "height:10px; background:#e2e8f0; border-radius:999px; overflow:hidden;";
  const fill = document.createElement("div");
  fill.style.cssText = "height:100%; width:0%; background:#2563eb; transition:width .25s;";
  track.appendChild(fill);
  progWrap.append(progTop, track);

  const msg = document.createElement("div");
  msg.style.cssText = "font-size:.8rem; color:#64748b; margin-bottom:12px; display:none;";
  const setMsg = (text, isError) => {
    msg.style.display = "block";
    msg.style.color = isError ? "#dc2626" : "#64748b";
    msg.textContent = text;
  };

  const row = document.createElement("div");
  row.style.cssText = "display:flex; gap:10px;";

  const btnUpdate = document.createElement("button");
  btnUpdate.textContent = "Update";
  btnUpdate.style.cssText =
    "flex:1; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-weight:600;";
  row.appendChild(btnUpdate);

  const btnBrowser = document.createElement("button");
  btnBrowser.textContent = "Download in browser";
  btnBrowser.style.cssText =
    "display:none; padding:12px; background:#e2e8f0; color:#0f172a; border:none; border-radius:8px; font-weight:600; font-size:.8rem;";
  btnBrowser.addEventListener("click", async () => {
    try { await openUrl(info.apk_url); } catch (e) { setMsg(`❌ ${e}`, true); }
  });
  row.appendChild(btnBrowser);

  if (!info.force) {
    const btnLater = document.createElement("button");
    btnLater.textContent = "Later";
    btnLater.style.cssText =
      "padding:12px 18px; background:#e2e8f0; color:#0f172a; border:none; border-radius:8px; font-weight:600;";
    btnLater.addEventListener("click", () => overlay.remove());
    row.appendChild(btnLater);
  }

  let downloaded = false; // true once the download finishes
  let apkPath = null;     // cache path of the downloaded APK

  // Download entirely in JS (fetch + fs) — no native "update_download" command needed
  async function doDownload() {
    if (!/^https:\/\//i.test(info.apk_url)) throw new Error("Invalid APK link");
    progWrap.style.display = "block";
    progLabel.textContent = "Downloading...";
    progPct.textContent = "0%";
    fill.style.width = "0%";

    const cacheDir = await appCacheDir();
    apkPath = await join(cacheDir, "update.apk");
    try { await remove(apkPath); } catch (_) {} // clear any stale partial file

    const res = await fetch(info.apk_url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;

    if (res.body && typeof res.body.getReader === "function") {
      // Streaming: update progress per chunk
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (total > 0) {
          const pct = Math.min(100, Math.round((got / total) * 100));
          fill.style.width = `${pct}%`;
          progPct.textContent = `${pct}%`;
          progLabel.textContent = `${mb(got)} / ${mb(total)} MB`;
        } else {
          progLabel.textContent = `${mb(got)} MB`;
        }
      }
      const buf = new Uint8Array(got);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }
      await fsWriteFile(apkPath, buf);
    } else {
      // Fallback: single blob
      const buf = new Uint8Array(await res.arrayBuffer());
      await fsWriteFile(apkPath, buf);
      progLabel.textContent = `${mb(buf.length)} MB`;
    }

    fill.style.width = "100%";
    progPct.textContent = "100%";
    progLabel.textContent = "Download complete";
    downloaded = true;
  }

  // Try update_install with a path arg first; fall back to no-arg if the command
  // doesn't expect one (so both possible Rust signatures work).
  async function doInstall() {
    const attempts = [];
    if (apkPath) { attempts.push({ path: apkPath }, { apkPath }); }
    attempts.push({});
    let lastErr;
    for (const args of attempts) {
      try {
        const r = await invoke("update_install", args);
        if (r && r.needsPermission) {
          setMsg("Enable “Allow from this source” in Settings, come back to the app, and tap “Install” again.", false);
          btnUpdate.disabled = false;
          btnUpdate.textContent = "Install";
          return;
        }
        setMsg("Installer opened. Tap “Install/Update”.", false);
        btnUpdate.disabled = false;
        btnUpdate.textContent = "Install again";
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  btnUpdate.addEventListener("click", async () => {
    btnUpdate.disabled = true;
    btnBrowser.style.display = "none";
    msg.style.display = "none";
    try {
      if (!downloaded) {
        btnUpdate.textContent = "Downloading...";
        await doDownload();
      }
      btnUpdate.textContent = "Installing...";
      await doInstall();
    } catch (err) {
      setMsg(`❌ ${err}`, true);
      btnUpdate.disabled = false;
      btnUpdate.textContent = downloaded ? "Try again" : "Download again";
      btnBrowser.style.display = "block"; // Browser fallback on failure
    }
  });

  card.append(title, ver, notes, progWrap, msg, row);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}


async function checkForUpdate() {
  try {
    let current = FALLBACK_VERSION;
    try { current = await getVersion(); } catch (_) {}

    const res = await fetch(`${UPDATE_JSON_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const info = await res.json();
    if (!info.app_version || !info.apk_url) return;

    if (isNewer(info.app_version, current)) showUpdateModal(info, current);
  } catch (err) {
    // Silently skip when offline
    console.warn("Update check failed:", err);
  }
}

log("✅ App ready");
checkForUpdate();
initAds();
