#!/usr/bin/env node
"use strict";
// Fetches rental-house candidates from OLX. The bairro search-results page
// (olx.com.br/imoveis/aluguel/casas/estado-{uf}/regiao-de-.../{city}/{bairro-slug}) is plain
// server-rendered HTML with <a href> links to individual listings -- no JS needed to read it.
// Each individual listing page embeds full structured data in
// <script id="initial-data" type="text/plain" data-json="...">, HTML-entity-escaped JSON.
//
// Usage:
//   node fetch-olx.js --neighborhoods="Renascença,Itararé" --uf=pi --region=regiao-de-teresina-e-parnaiba --city=teresina
//     [--min-bedrooms=2 --min-area=50 --max-total=1300]

const { fetchHtml, slugify, parseArgs, matchesFiltros } = require("./lib.js");

function log(...a) { console.error(...a); }

function extractListingUrls(html) {
  const re = /href="(https:\/\/[a-z.]*olx\.com\.br\/[^"]*-\d{6,})"/g;
  const set = new Set();
  let m;
  while ((m = re.exec(html))) set.add(m[1]);
  return [...set];
}

function extractAd(html) {
  const m = html.match(/<script id="initial-data"[^>]*data-json="([\s\S]*?)"><\/script>/);
  if (!m) return null;
  const text = m[1].replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  try { return JSON.parse(text).ad; } catch { return null; }
}

function propValue(props, name) {
  const p = (props || []).find((x) => x.name === name);
  return p ? p.value : null;
}

function toNumber(s) {
  if (s == null) return null;
  const n = String(s).replace(/[^\d]/g, "");
  return n ? Number(n) : null;
}

function toCandidate(ad) {
  const props = ad.properties;
  const rent = toNumber(ad.priceValue || ad.price);
  const condoRaw = propValue(props, "condominio");
  const condo = condoRaw ? toNumber(condoRaw) : null;
  const total = rent != null ? rent + (condo || 0) : null;
  const reFeatures = (props || []).filter((p) => p.name === "re_features" || p.name === "re_complex_features")
    .flatMap((p) => (p.values || []).map((v) => v.label));
  const advertiser = ad.user && (ad.user.name || ad.user.legacyProfileName) || "Não informado";
  const phone = ad.phone && ad.phone.number ? ad.phone.number : null;
  return {
    title: ad.subject || null,
    type: "Casa",
    neighborhood: ad.location && ad.location.neighbourhood || null,
    city: ad.location && ad.location.municipality || null,
    state: ad.location && ad.location.uf || null,
    address: "Endereço não informado",
    rent, condo, condoLabel: condo === 0 ? "Isento" : condo == null ? "Não informado" : String(condo),
    iptu: null,
    total,
    area: toNumber(propValue(props, "size")),
    bedrooms: toNumber(propValue(props, "rooms")),
    suites: null,
    bathrooms: toNumber(propValue(props, "bathrooms")),
    parking: toNumber(propValue(props, "garage_spaces")),
    furnished: null,
    amenities: reFeatures,
    description: ad.body ? ad.body.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "") : null,
    advertiser,
    advertiserPhone: phone,
    photo: ad.images && ad.images[0] && ad.images[0].original || null,
    lat: ad.location && ad.location.mapLati || null,
    lng: ad.location && ad.location.mapLong || null,
    locationAccuracy: "Coordenadas do anúncio (portal)",
    sources: [{ name: "OLX", url: ad.friendlyUrl || ad.canonicalUrl, kind: "direct", portalListingId: String(ad.listId) }],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uf = (args.uf || "pi").toLowerCase();
  const city = (args.city || "teresina").toLowerCase();
  const region = args.region || "regiao-de-teresina-e-parnaiba";
  const filters = {
    state: uf,
    city,
    neighborhoods: (args.neighborhoods || "").split(",").map((s) => s.trim()).filter(Boolean),
    minBedrooms: args["min-bedrooms"] != null ? Number(args["min-bedrooms"]) : null,
    minArea: args["min-area"] != null ? Number(args["min-area"]) : null,
    maxTotal: args["max-total"] != null ? Number(args["max-total"]) : null,
  };

  const allUrls = new Set();
  for (const hood of filters.neighborhoods) {
    const slug = slugify(hood);
    const url = `https://www.olx.com.br/imoveis/aluguel/casas/estado-${uf}/${region}/${city}/${slug}`;
    const res = await fetchHtml(url);
    if (!res.ok) { log(`[OLX] bairro "${hood}" (slug=${slug}): HTTP ${res.status}`); continue; }
    let urls = extractListingUrls(res.text);
    // OLX's bairro-slug URL doesn't always actually filter -- some neighborhoods (Dirceu
    // confirmed) silently fall back to an unfiltered city page instead of 404ing. A result
    // count at/near OLX's ~50-per-page cap is the signal; cap how many individual pages we
    // fetch in that case rather than burning 50 requests on mostly-wrong candidates (the real
    // neighborhood filter in matchesFiltros() would reject them anyway, so this only saves
    // requests, not correctness).
    if (urls.length >= 20) {
      log(`[OLX] bairro "${hood}" (slug=${slug}): ${urls.length} links -- suspiciously high, filter probably didn't apply; capping to first 10`);
      urls = urls.slice(0, 10);
    } else {
      log(`[OLX] bairro "${hood}" (slug=${slug}): ${urls.length} listing link(s) found`);
    }
    urls.forEach((u) => allUrls.add(u));
  }

  const candidates = [];
  let fetched = 0, parseFailed = 0;
  for (const url of allUrls) {
    const res = await fetchHtml(url);
    if (!res.ok) { log(`[OLX] listing fetch failed (${res.status}): ${url}`); continue; }
    const ad = extractAd(res.text);
    if (!ad) { parseFailed++; log(`[OLX] could not parse initial-data for: ${url}`); continue; }
    fetched++;
    const c = toCandidate(ad);
    if (matchesFiltros(c, filters)) candidates.push(c);
  }

  log(`[OLX] TOTAL: ${allUrls.size} unique listing link(s), ${fetched} fetched ok (${parseFailed} parse failures), ${candidates.length} passed filters`);
  process.stdout.write(JSON.stringify(candidates, null, 2) + "\n");
}

main().catch((e) => { log("FATAL:", e.message); process.exit(1); });
