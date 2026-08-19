#!/usr/bin/env node
"use strict";
// Fetches rental-house candidates from ZAP Imoveis / Viva Real (same backend, same page schema:
// data is embedded as Next.js RSC stream chunks — self.__next_f.push([1,"...json escaped..."]) —
// which concatenate into one big string containing a "listings":[...] array).
//
// Usage:
//   node fetch-grupozap.js --portal=zap --neighborhoods="Renascença,Itararé" --tipo=casas
//     [--city=teresina --state=pi --min-bedrooms=2 --min-area=50 --max-total=1300]
//
// Output: JSON array on stdout (schema per REFERENCE.md). Diagnostics on stderr.

const { fetchHtml, slugify, parseArgs, extractBalanced, matchesFiltros, translateAmenity } = require("./lib.js");

const PORTAL_NAMES = { zap: "ZAP Imóveis", vivareal: "Viva Real" };

// pt-BR state abbreviation -> full name (unaccented), needed for Viva Real's URL scheme.
const STATE_NAMES = {
  ac: "acre", al: "alagoas", ap: "amapa", am: "amazonas", ba: "bahia", ce: "ceara",
  df: "distrito-federal", es: "espirito-santo", go: "goias", ma: "maranhao",
  mt: "mato-grosso", ms: "mato-grosso-do-sul", mg: "minas-gerais", pa: "para",
  pb: "paraiba", pr: "parana", pe: "pernambuco", pi: "piaui", rj: "rio-de-janeiro",
  rn: "rio-grande-do-norte", rs: "rio-grande-do-sul", ro: "rondonia", rr: "roraima",
  sc: "santa-catarina", sp: "sao-paulo", se: "sergipe", to: "tocantins",
};

function bairroUrl(portal, state, city, slug) {
  if (portal === "zap") return `https://www.zapimoveis.com.br/aluguel/casas/${state}+${city}++${slug}/`;
  return `https://www.vivareal.com.br/aluguel/${STATE_NAMES[state] || state}/${city}/bairros/${slug}/casa_residencial/`;
}

function cityWideUrl(portal, state, city, page) {
  const suffix = page > 1 ? `?pagina=${page}` : "";
  if (portal === "zap") return `https://www.zapimoveis.com.br/aluguel/casas/${state}+${city}/${suffix}`;
  return `https://www.vivareal.com.br/aluguel/${STATE_NAMES[state] || state}/${city}/casa_residencial/${suffix}`;
}

function log(...a) { console.error(...a); }

function extractListings(html) {
  const re = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  let m, joined = "";
  while ((m = re.exec(html))) {
    try { joined += JSON.parse('"' + m[1] + '"'); } catch { /* skip malformed chunk */ }
  }
  const key = '"listings":[';
  const start = joined.indexOf(key);
  if (start === -1) return null;
  const arrText = extractBalanced(joined, start + key.length - 1);
  if (!arrText) return null;
  try { return JSON.parse(arrText); } catch { return null; }
}

function toCandidate(raw, portalName) {
  const rental = raw.prices && raw.prices.rental;
  const am = raw.amenities || {};
  const rent = rental ? rental.value : null;
  const condo = rental ? rental.condominium : null;
  const total = rent != null ? rent + (condo || 0) : null;
  const adv = raw.advertiser || {};
  return {
    title: raw.title || null,
    type: "Casa",
    neighborhood: raw.address && raw.address.neighborhood || null,
    city: raw.address && raw.address.city || null,
    state: raw.address && raw.address.stateAcronym || null,
    address: raw.address && (raw.address.street ? `${raw.address.street}, ${raw.address.streetNumber || "s/n"}` : null),
    rent, condo, condoLabel: condo === 0 ? "Isento" : condo == null ? "Não informado" : String(condo),
    iptu: rental ? rental.iptu : null,
    total,
    area: am.usableAreas && am.usableAreas[0] || null,
    bedrooms: am.bedrooms && am.bedrooms[0] || null,
    suites: am.suites && am.suites[0] != null ? am.suites[0] : null,
    bathrooms: am.bathrooms && am.bathrooms[0] || null,
    parking: am.parkingSpaces && am.parkingSpaces[0] || null,
    furnished: null,
    amenities: (am.values || []).map(translateAmenity),
    description: raw.description || null,
    advertiser: adv.name || "Não informado",
    advertiserPhone: adv.phoneNumbers && adv.phoneNumbers[0] || null,
    photo: raw.medias && raw.medias.images && raw.medias.images[0] && raw.medias.images[0].dangerousSrc
      ? raw.medias.images[0].dangerousSrc.replace("{description}", "img").replace("{action}", "crop").replace("{width}x{height}", "800x600")
      : null,
    lat: raw.address && raw.address.coordinates && raw.address.coordinates.latitude || null,
    lng: raw.address && raw.address.coordinates && raw.address.coordinates.longitude || null,
    locationAccuracy: "Coordenadas do anúncio (portal)",
    sources: [{ name: portalName, url: raw.href, kind: "direct", portalListingId: raw.id }],
  };
}

async function fetchNeighborhood(portal, portalName, hood, filters) {
  const slug = slugify(hood);
  const url = bairroUrl(portal, filters.state, filters.city, slug);
  const res = await fetchHtml(url);
  if (res.status === 404) {
    log(`[${portalName}] bairro slug "${slug}" -> 404, will rely on city-wide fallback for "${hood}"`);
    return { listings: [], needsCityWideFallback: true };
  }
  if (!res.ok) {
    log(`[${portalName}] bairro "${hood}" fetch failed: HTTP ${res.status}`);
    return { listings: [], needsCityWideFallback: false, blocked: true };
  }
  const listings = extractListings(res.text);
  if (listings == null) {
    log(`[${portalName}] bairro "${hood}": page loaded but listings JSON not found (markup may have changed)`);
    return { listings: [], needsCityWideFallback: false, parseFailed: true };
  }
  log(`[${portalName}] bairro "${hood}" (slug=${slug}): ${listings.length} listing(s) on page`);
  return { listings, needsCityWideFallback: false };
}

async function fetchCityWidePages(portal, portalName, filters, maxPages = 5) {
  let all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = cityWideUrl(portal, filters.state, filters.city, page);
    const res = await fetchHtml(url);
    if (!res.ok) { log(`[${portalName}] city-wide page ${page} failed: HTTP ${res.status}`); break; }
    const listings = extractListings(res.text);
    if (!listings || !listings.length) break;
    all = all.concat(listings);
    if (listings.length < 30) break; // last page
  }
  log(`[${portalName}] city-wide fallback: ${all.length} listing(s) scanned across pages`);
  return all;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const portal = args.portal || "zap";
  const portalName = PORTAL_NAMES[portal];
  if (!portalName) { log(`Unknown --portal=${portal}, expected zap|vivareal`); process.exit(1); }

  const filters = {
    state: (args.state || "pi").toLowerCase(),
    city: (args.city || "teresina").toLowerCase(),
    neighborhoods: (args.neighborhoods || "").split(",").map((s) => s.trim()).filter(Boolean),
    minBedrooms: args["min-bedrooms"] != null ? Number(args["min-bedrooms"]) : null,
    minArea: args["min-area"] != null ? Number(args["min-area"]) : null,
    maxTotal: args["max-total"] != null ? Number(args["max-total"]) : null,
  };

  let rawListings = [];
  let needsFallback = false;
  for (const hood of filters.neighborhoods) {
    const r = await fetchNeighborhood(portal, portalName, hood, filters);
    rawListings = rawListings.concat(r.listings);
    if (r.needsCityWideFallback) needsFallback = true;
  }
  if (needsFallback) {
    const cityWide = await fetchCityWidePages(portal, portalName, filters);
    rawListings = rawListings.concat(cityWide);
  }

  const seen = new Set();
  const candidates = [];
  for (const raw of rawListings) {
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    const c = toCandidate(raw, portalName);
    if (matchesFiltros(c, filters)) candidates.push(c);
  }

  log(`[${portalName}] TOTAL: ${rawListings.length} raw listing(s) seen, ${candidates.length} passed filters`);
  process.stdout.write(JSON.stringify(candidates, null, 2) + "\n");
}

main().catch((e) => { log("FATAL:", e.message); process.exit(1); });
