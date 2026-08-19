"use strict";

const { execFile } = require("node:child_process");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Node's own fetch() (undici) gets 403'd by these portals' bot-detection even with a matching
// User-Agent header -- almost certainly a TLS/HTTP2 fingerprint check. curl is NOT flagged the
// same way, so we shell out to it instead of using global fetch. Verified against ZAP/OLX/
// ImovelWeb/Viva Real during this skill's development.
function fetchHtml(url) {
  return new Promise((resolve) => {
    execFile(
      "curl",
      ["-sL", "-A", UA, "-H", "Accept-Language: pt-BR,pt;q=0.9", "-w", "\n__STATUS__%{http_code}__STATUS__", url],
      { maxBuffer: 50 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) { resolve({ status: 0, ok: false, text: null, url }); return; }
        const m = stdout.match(/__STATUS__(\d+)__STATUS__$/);
        const status = m ? Number(m[1]) : 0;
        const text = stdout.replace(/\n?__STATUS__\d+__STATUS__$/, "");
        resolve({ status, ok: status >= 200 && status < 300, text: status ? text : null, url });
      }
    );
  });
}

function slugify(s) {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Extracts a JSON value that starts at `startIdx` (pointing at '{' or '[') via bracket matching,
// tolerant of strings containing braces/brackets.
function extractBalanced(text, startIdx) {
  const open = text[startIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, strCh = null, esc = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === "\\") { esc = true; }
      else if (ch === strCh) { inStr = false; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  return null;
}

// FILTROS matching. `l` must have: neighborhood, city, bedrooms, area, total (numbers/strings ok).
function matchesFiltros(l, f) {
  if (f.neighborhoods && f.neighborhoods.length) {
    const n = stripAccentsLower(l.neighborhood || "");
    if (!f.neighborhoods.some((x) => stripAccentsLower(x) === n)) return false;
  }
  if (f.city && stripAccentsLower(l.city || "") !== stripAccentsLower(f.city)) return false;
  if (f.minBedrooms != null && !(Number(l.bedrooms) >= f.minBedrooms)) return false;
  if (f.minArea != null && !(Number(l.area) >= f.minArea)) return false;
  if (f.maxTotal != null && !(Number(l.total) <= f.maxTotal)) return false;
  return true;
}

function stripAccentsLower(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// ZAP/Viva Real amenities come back as opaque uppercase codes (LARGE_ROOM, PETS_ALLOWED, ...),
// not display text. Known codes translated to pt-BR; unknown codes are prettified as a fallback
// (title-cased, underscores to spaces) rather than dropped, so nothing silently disappears.
const AMENITY_LABELS = {
  LARGE_ROOM: "Sala ampla", SERVICE_ROOM: "Quarto de serviço", INTEGRATED_ENVIRONMENTS: "Ambientes integrados",
  HOME_OFFICE: "Escritório", PANTRY: "Despensa", COPA: "Copa", PETS_ALLOWED: "Aceita pets",
  LARGE_KITCHEN: "Cozinha espaçosa", LARGE_WINDOW: "Janelas amplas", BACKYARD: "Quintal",
  BALCONY: "Varanda", BARBECUE_GRILL: "Churrasqueira", GARDEN: "Jardim", POOL: "Piscina",
  FURNISHED: "Mobiliado", GATED_COMMUNITY: "Condomínio fechado", ELEVATOR: "Elevador",
};

function translateAmenity(code) {
  if (AMENITY_LABELS[code]) return AMENITY_LABELS[code];
  if (!/^[A-Z_]+$/.test(code)) return code; // already plain text (e.g. from OLX/ImovelWeb)
  return code.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

module.exports = { UA, fetchHtml, slugify, parseArgs, extractBalanced, matchesFiltros, stripAccentsLower, translateAmenity };
