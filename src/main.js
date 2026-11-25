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
    <p style="color: #64748b; font-size: 0.9rem; margin: 0 0 16px;">PDF ও ছবি থেকে টেক্সট</p>

    <div style="background:#fff; padding:16px; border-radius:12px; margin-bottom:16px;">
      <div style="display:flex; flex-wrap:wrap; gap:12px; margin-bottom:14px;">
        <div style="flex:1 1 100%;">
          <label style="font-size:.85rem;font-weight:600;">ফরম্যাট</label>
          <select id="format" style="width:100%; padding:8px; margin-top:4px;">
          </select>
        </div>
        <div style="flex:1 1 100%;">
          <label style="font-size:.85rem;font-weight:600;">ভাষা <span style="font-weight:400;color:#64748b;">(সর্বোচ্চ ৩টি)</span></label>
          <button id="lang-btn" type="button" style="display:block; width:100%; padding:10px; margin-top:4px; text-align:left; border:1px solid #767676; border-radius:4px; background:#fff; color:#0f172a; font-size:1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">—</button>
          <input type="hidden" id="langs" value="eng+ben">
        </div>
      </div>
      <div style="display:flex; gap:10px;">
        <button id="btn-pdf" style="flex:1; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-weight:600;">PDF</button>
        <button id="btn-img" style="flex:1; padding:12px; background:#059669; color:#fff; border:none; border-radius:8px; font-weight:600;">ছবি</button>
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
      <pre id="status" style="margin:0; white-space:pre-wrap; font-size:.85rem; max-height:280px; overflow-y:auto;">প্রস্তুত।</pre>
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
  // কাজ চলার সময় উপরে বড় বিজ্ঞাপন, শেষে নিচে ব্যানার
  if (busy) enterWorkAds(); else leaveWorkAds();
}

// ================= ভাষা নির্বাচন (Tesseract-এর সব ভাষা, সর্বোচ্চ ৩টি একসাথে) =================
const MAX_LANGS = 3;
// [কোড, ইংরেজি নাম, নিজস্ব নাম]
const LANGUAGES = [
  ["afr", "Afrikaans", "Afrikaans"], ["amh", "Amharic", "አማርኛ"], ["ara", "Arabic", "العربية"],
  ["asm", "Assamese", "অসমীয়া"], ["aze", "Azerbaijani", "Azərbaycan"], ["aze_cyrl", "Azerbaijani (Cyrillic)", ""],
  ["bel", "Belarusian", "Беларуская"], ["ben", "Bengali", "বাংলা"], ["bod", "Tibetan", "བོད་ཡིག"],
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
  title.textContent = `ভাষা বাছুন (সর্বোচ্চ ${MAX_LANGS}টি)`;
  title.style.cssText = "font-size:1.1rem; font-weight:700; margin-bottom:4px;";
  const hint = document.createElement("div");
  hint.textContent = "একই PDF/ছবিতে একাধিক ভাষা থাকলে সবগুলো বাছুন। যত বেশি ভাষা, তত ধীর ও বেশি মেমরি লাগে।";
  hint.style.cssText = "font-size:.78rem; color:#64748b; margin-bottom:10px;";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "খুঁজুন (নাম বা কোড)";
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
  btnOk.textContent = "ঠিক আছে";
  btnOk.style.cssText =
    "flex:1; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-weight:600;";
  const btnCancel = document.createElement("button");
  btnCancel.textContent = "বাতিল";
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
    count.textContent = `নির্বাচিত: ${pick.length}/${MAX_LANGS}  ${pick.map(langLabel).join(" + ")}`;
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
// done = সম্পন্ন আইটেম সংখ্যা, frac = বর্তমান আইটেমের অগ্রগতি (0..1)
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
  progressLabel.textContent = `${kind} ${total}/${total} সম্পন্ন`;
  progressPct.textContent = "100%";
  progressBar.style.width = "100%";
  progressSub.textContent = "";
}

// content:// URI থেকে ফাইলের নাম (এক্সটেনশন ছাড়া) বের করি
function baseNameOf(p, fallback) {
  let s = p;
  try { s = decodeURIComponent(p); } catch (_) {}
  s = s.split(/[/\\:]/).pop().replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!s || /^\d+$/.test(s)) return fallback;
  return s;
}

// ---------- ZIP (স্টোর-মোড) — DOCX/ODT-এর জন্য, বাইরের লাইব্রেরি ছাড়া ----------
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

// files: { "নাম": Uint8Array | [Uint8Array, opts] } — ঢোকানোর ক্রমই ফাইলের ক্রম
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

// ================= আউটপুট ফরম্যাট (Word থেকে Linux-এর সব টেক্সট ফরম্যাট) =================
const xmlEsc = (s) =>
  String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

// টেক্সটকে অনুচ্ছেদে ভাগ: ফাঁকা লাইনে অনুচ্ছেদ, এক লাইনের বিরতি লাইন-ব্রেক
const toParagraphs = (text) =>
  String(text).replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/).map((p) => p.split("\n").map((l) => l.trimEnd()));

// CSV/TSV ঘর
const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;

// RTF: ASCII-র বাইরের অক্ষর \uN? আকারে
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

// LaTeX বিশেষ অক্ষর
const texEsc = (s) =>
  String(s)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");

const bodyText = (text) => String(text).replace(/\r\n?/g, "\n").trim();

// id, লেবেল, এক্সটেনশন, mime, binary?, build(text, source)
const FORMATS = [
  { id: "txt", label: "TXT — সাধারণ টেক্সট", ext: "txt", mime: "text/plain",
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
      `% XeLaTeX বা LuaLaTeX দিয়ে কম্পাইল করুন (ইউনিকোড/বাংলা সমর্থনের জন্য)\n` +
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
        // mimetype সবার আগে ও সংকোচন ছাড়া থাকতে হয়
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
  // Word-এর পুরনো .doc ফরম্যাট: আসলে RTF, Word সরাসরি খুলতে পারে
  { id: "doc", label: "MS Word 97-2003 (.doc, RTF-ভিত্তিক)", ext: "doc", mime: "application/msword",
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

// ফরম্যাট তালিকা পূরণ
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

// ফাইলের দেখানোর নাম (এক্সটেনশনসহ), content:// URI থেকে
function displayName(p) {
  let s = String(p);
  try { s = decodeURIComponent(s); } catch (_) {}
  return s.split(/[/\\:]/).pop() || s;
}

// Android SAF: ফাইলের এক্সটেনশনের সাথে না মেলা পরিচিত mime দিলে নামের শেষে আলাদা এক্সটেনশন জোড়া লাগে
// (যেমন "1.adoc.txt")। তাই শুধু মিলে যাওয়া ফরম্যাটে আসল mime, বাকিগুলোয় octet-stream।
const SAFE_MIME_EXT = new Set(["txt", "html", "xml", "json", "csv", "docx", "odt"]);

// আউটপুট ফাইল তৈরি ও সেভ; সেভ হওয়া ফাইলের নাম ফেরত দেয়
async function saveOutput(folderId, baseName, text, formatId, source) {
  const f = FORMAT_MAP[formatId] || FORMAT_MAP.txt;
  const name = `${baseName}.${f.ext}`;
  const data = f.build(text, displayName(source));
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const mimeType = SAFE_MIME_EXT.has(f.ext) ? f.mime : "application/octet-stream";
  const opts = { mimeType };
  if (name.includes("/")) opts.recursive = true; // সাবফোল্ডার না থাকলে বানাবে
  await writeFile(folderId, name, bytes, opts);
  return name;
}

// "best" মডেল (বেশি নির্ভুল, তবে ডাউনলোড বড়)। সমস্যা হলে "" করলে ডিফল্ট মডেল চলবে।
const TESS_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0_best";

// একটাই worker বানাই; logger দিয়ে OCR-এর % আপডেট হয়
// ctx = { kind, index, total, base } — base = OCR শুরুর আগে কত অংশ শেষ (0..1)
async function makeWorker(langs, ctx) {
  const Tesseract = (await import("tesseract.js")).default;
  const opts = {
    logger: (m) => {
      if (m.status === "recognizing text") {
        const frac = ctx.base + (1 - ctx.base) * m.progress;
        setProgress(ctx.kind, ctx.index, ctx.total, frac, "OCR চলছে...");
      }
    },
  };
  if (TESS_LANG_PATH) opts.langPath = TESS_LANG_PATH;
  const worker = await Tesseract.createWorker(langs, 1, opts);
  // টেবিলের কলামের ফাঁক ধরে রাখে
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
    statusEl.textContent = "PDF প্রসেসিং...";
    progressBox.style.display = "none";

    // content:// URI থেকে পড়ে cache-এ কপি
    log("PDF কপি করা হচ্ছে...");
    const pdfBytes = await readFile(selected);
    const cacheDir = await appCacheDir();
    localPdfPath = await join(cacheDir, "input.pdf");
    await fsWriteFile(localPdfPath, pdfBytes);

    log("PDF পেজ সংখ্যা বের করা হচ্ছে...");
    const pageCount = await invoke("get_pdf_page_count", { pdfPath: localPdfPath });
    log(`মোট ${pageCount} পেজ পাওয়া গেছে।`);

    // আউটপুট ফোল্ডার: pdfname_image (ছবি) ও pdfname_text (টেক্সট)
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const pdfBase = baseNameOf(selected, `pdf_${stamp}`);
    const imageDir = `${pdfBase}_image`;
    const textDir = `${pdfBase}_text`;
    log(`ফোল্ডার: ${imageDir}, ${textDir}`);

    const ctx = { kind: "পেজ", index: 0, total: pageCount, base: 0.1 };
    setProgress("পেজ", 0, pageCount, 0, "OCR ইঞ্জিন লোড হচ্ছে...");
    worker = await makeWorker(langs, ctx);

    // প্রতিটি পেজ: রেন্ডার → ছবি সেভ → OCR → টেক্সট সেভ
    for (let i = 0; i < pageCount; i++) {
      ctx.index = i;

      setProgress("পেজ", i, pageCount, 0, "রেন্ডার হচ্ছে (৩০০ DPI)...");
      // Rust দুটো ফাইল cache-এ লেখে: fullPath (৫০০ DPI), ocrPath (৩০০ DPI)
      const res = await invoke("render_pdf_page", {
        pdfPath: localPdfPath,
        pageIndex: i,
        outDir: cacheDir,
      });

      const imgPath = `${imageDir}/${i + 1}.png`;
      setProgress("পেজ", i, pageCount, 0.05, "ছবি সেভ হচ্ছে...");
      let fullBytes = await readFile(res.fullPath);
      await writeFile(folder.id, imgPath, fullBytes, { mimeType: "image/png", recursive: true });
      fullBytes = null;
      log(`✔ ছবি ${i + 1}/${pageCount} সেভ: ${imgPath}`);

      // OCR (৩০০ DPI কপি; logger % আপডেট করবে)
      let ocrBytes = await readFile(res.ocrPath);
      const { data: { text } } = await worker.recognize(new Blob([ocrBytes], { type: "image/png" }));
      ocrBytes = null;

      // অস্থায়ী ফাইল মুছি
      try { await remove(res.fullPath); } catch (_) {}
      try { await remove(res.ocrPath); } catch (_) {}

      const txtPath = await saveOutput(folder.id, `${textDir}/${i + 1}`, text, format, imgPath);
      log(`✔ টেক্সট ${i + 1}/${pageCount} সেভ: ${txtPath}`);

      setProgress("পেজ", i + 1, pageCount, 0, `${i + 1} পেজ সম্পন্ন`);
    }
    finishProgress("পেজ", pageCount);
    log("🎉 সম্পন্ন!");
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

// ================= ছবি =================
btnImg.addEventListener("click", async () => {
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
    statusEl.textContent = "OCR শুরু...";
    progressBox.style.display = "none";

    const total = selected.length;
    const ctx = { kind: "ছবি", index: 0, total, base: 0.1 };
    setProgress("ছবি", 0, total, 0, "OCR ইঞ্জিন লোড হচ্ছে...");
    worker = await makeWorker(langs, ctx);

    for (let i = 0; i < total; i++) {
      ctx.index = i;
      const imgPath = selected[i];
      const outBase = baseNameOf(imgPath, `image_${i + 1}`);

      setProgress("ছবি", i, total, 0, "ছবি পড়া হচ্ছে...");
      const bytes = await readFile(imgPath);

      const { data: { text } } = await worker.recognize(new Blob([bytes]));

      const fileName = await saveOutput(folder.id, outBase, text, format, imgPath);
      log(`✔ ${i + 1}/${total} সেভ: ${fileName}`);

      setProgress("ছবি", i + 1, total, 0, `${i + 1} ছবি সম্পন্ন`);
    }
    finishProgress("ছবি", total);
    log("🎉 সম্পন্ন!");
    showInterstitialIfDue();
  } catch (err) {
    log(`❌ ${err}`);
    console.error(err);
  } finally {
    if (worker) { try { await worker.terminate(); } catch (_) {} }
    setBusy(false);
  }
});

// ================= বিজ্ঞাপন (AdMob) =================
// ⚠️ নিচের আইডিগুলো Google-এর টেস্ট আইডি। প্রকাশের আগে নিজের AdMob আইডি বসান।
// টেস্ট আইডি ছাড়া নিজের বিজ্ঞাপনে নিজে ক্লিক করবেন না — অ্যাকাউন্ট বন্ধ হতে পারে।
const ADS = {
  enabled: true,
  bannerId: "ca-app-pub-3940256099942544/9214589741", // টেস্ট: অ্যাডাপ্টিভ ব্যানার
  // টেস্ট: ব্যানার-আইডি দিয়ে ৩০০×২৫০ চলে। আসল প্রকাশে AdMob-এ আলাদা "Banner" Ad Unit বানিয়ে বসান।
  mrecId: "ca-app-pub-3940256099942544/6300978111",
  interstitialId: "ca-app-pub-3940256099942544/1033173712", // টেস্ট: ইন্টারস্টিশিয়াল
  interstitialMinGapMs: 3 * 60 * 1000, // দুই ফুলস্ক্রিন বিজ্ঞাপনের মাঝে ন্যূনতম ৩ মিনিট
};
let lastInterstitialAt = 0;

const adsCall = (cmd, payload = {}) => invoke("ads_call", { cmd, payload });

let adsReady = false;
let adsChain = Promise.resolve(); // বিজ্ঞাপনের কল একটার পর একটা চলার জন্য
const queueAds = (fn) => {
  adsChain = adsChain.then(fn).catch((e) => console.warn("Ads:", e));
  return adsChain;
};

// কাজ শুরু: নিচের ব্যানার সরিয়ে উপরে ৩০০×২৫০ বিজ্ঞাপন
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

// কাজ শেষ: উপরের বিজ্ঞাপন সরিয়ে নিচে ব্যানার ফেরত
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
  b.textContent = "বিজ্ঞাপন গোপনীয়তা সেটিংস";
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
    // ব্যানার যাতে কনটেন্ট ঢেকে না দেয়
    if (b && b.height) document.body.style.paddingBottom = `${Math.ceil(b.height) + 8}px`;

    await adsCall("loadInterstitial", { unitId: ADS.interstitialId });
    if (r.privacyOptionsRequired) addPrivacyLink();
  } catch (err) {
    console.warn("Ads init failed:", err);
  }
}

// কাজ সম্পন্ন হলে (স্বাভাবিক বিরতিতে) ফুলস্ক্রিন বিজ্ঞাপন, ফ্রিকোয়েন্সি সীমা মেনে
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

// ================= আপডেট চেক =================
// Hugging Face-এর JSON ফাইল: { "app_version": "v1.0.1", "update_notes": "...", "apk_url": "https://..." }
// ঐচ্ছিক: "force": true দিলে "পরে" বাটন থাকবে না।
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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mb = (n) => (n / 1048576).toFixed(1);

  const overlay = document.createElement("div");
  overlay.id = "update-modal";
  overlay.style.cssText =
    "position:fixed; inset:0; background:rgba(15,23,42,.6); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#fff; border-radius:16px; padding:20px; width:100%; max-width:380px; box-shadow:0 10px 40px rgba(0,0,0,.3);";

  const title = document.createElement("div");
  title.textContent = "🔔 নতুন আপডেট এসেছে";
  title.style.cssText = "font-size:1.15rem; font-weight:700; margin-bottom:6px;";

  const ver = document.createElement("div");
  ver.textContent = `বর্তমান: v${String(currentVer).replace(/^v/i, "")}  →  নতুন: v${String(info.app_version).replace(/^v/i, "")}`;
  ver.style.cssText = "font-size:.85rem; color:#64748b; margin-bottom:12px;";

  const notes = document.createElement("div");
  notes.textContent = info.update_notes || "";
  notes.style.cssText =
    "font-size:.95rem; margin-bottom:16px; white-space:pre-wrap; max-height:160px; overflow-y:auto;";

  // ডাউনলোড প্রগ্রেস
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
  btnUpdate.textContent = "আপডেট করুন";
  btnUpdate.style.cssText =
    "flex:1; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-weight:600;";
  row.appendChild(btnUpdate);

  const btnBrowser = document.createElement("button");
  btnBrowser.textContent = "ব্রাউজারে ডাউনলোড";
  btnBrowser.style.cssText =
    "display:none; padding:12px; background:#e2e8f0; color:#0f172a; border:none; border-radius:8px; font-weight:600; font-size:.8rem;";
  btnBrowser.addEventListener("click", async () => {
    try { await openUrl(info.apk_url); } catch (e) { setMsg(`❌ ${e}`, true); }
  });
  row.appendChild(btnBrowser);

  if (!info.force) {
    const btnLater = document.createElement("button");
    btnLater.textContent = "পরে";
    btnLater.style.cssText =
      "padding:12px 18px; background:#e2e8f0; color:#0f172a; border:none; border-radius:8px; font-weight:600;";
    btnLater.addEventListener("click", () => overlay.remove());
    row.appendChild(btnLater);
  }

  let downloaded = false; // ডাউনলোড শেষ হলে true

  async function doInstall() {
    const r = await invoke("update_install");
    if (r && r.needsPermission) {
      setMsg("সেটিংসে “এই উৎস থেকে অনুমতি দিন” চালু করে অ্যাপে ফিরে এসে আবার “ইনস্টল করুন” চাপুন।", false);
      btnUpdate.disabled = false;
      btnUpdate.textContent = "ইনস্টল করুন";
      return;
    }
    setMsg("ইনস্টলার খোলা হয়েছে। “ইনস্টল/আপডেট” চাপুন।", false);
    btnUpdate.disabled = false;
    btnUpdate.textContent = "আবার ইনস্টল করুন";
  }

  async function doDownload() {
    if (!/^https:\/\//i.test(info.apk_url)) throw new Error("অবৈধ APK লিংক");
    progWrap.style.display = "block";
    progLabel.textContent = "ডাউনলোড হচ্ছে...";
    progPct.textContent = "0%";
    fill.style.width = "0%";

    await invoke("update_download", { url: info.apk_url });

    // প্রগ্রেস পোলিং
    while (true) {
      const p = await invoke("update_progress");
      if (p.state === "error") throw new Error(p.error || "ডাউনলোড ব্যর্থ");
      if (p.total > 0) {
        const pct = Math.min(100, Math.round((p.downloaded / p.total) * 100));
        fill.style.width = `${pct}%`;
        progPct.textContent = `${pct}%`;
        progLabel.textContent = `${mb(p.downloaded)} / ${mb(p.total)} MB`;
      } else {
        progLabel.textContent = `${mb(p.downloaded)} MB`;
        progPct.textContent = "";
      }
      if (p.state === "done") break;
      await sleep(400);
    }
    fill.style.width = "100%";
    progPct.textContent = "100%";
    progLabel.textContent = "ডাউনলোড সম্পন্ন";
    downloaded = true;
  }

  btnUpdate.addEventListener("click", async () => {
    btnUpdate.disabled = true;
    btnBrowser.style.display = "none";
    msg.style.display = "none";
    try {
      if (!downloaded) {
        btnUpdate.textContent = "ডাউনলোড হচ্ছে...";
        await doDownload();
      }
      btnUpdate.textContent = "ইনস্টল হচ্ছে...";
      await doInstall();
    } catch (err) {
      setMsg(`❌ ${err}`, true);
      btnUpdate.disabled = false;
      btnUpdate.textContent = downloaded ? "আবার চেষ্টা করুন" : "আবার ডাউনলোড";
      btnBrowser.style.display = "block"; // ব্যর্থ হলে ব্রাউজার বিকল্প
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
    // নেটওয়ার্ক না থাকলে চুপচাপ বাদ দিই
    console.warn("Update check failed:", err);
  }
}

log("✅ App ready");
checkForUpdate();
initAds();
