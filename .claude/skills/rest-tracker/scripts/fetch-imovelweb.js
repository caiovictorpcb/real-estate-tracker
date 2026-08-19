#!/usr/bin/env node
"use strict";
// Fetches rental-house candidates from ImovelWeb. Data is embedded as
// window.__PRELOADED_STATE__ = {...}; a plain (non-RSC-escaped) JSON object, at
// data.listStore.listPostings / data.listStore.paging.total.
//
// Field mapping verified against a real posting object (Dirceu/Itararé/Parque
// Ideal/Renascença had zero live listings during development, so verification used a
// listing surfaced by ImovelWeb's fallback behavior -- see the "suspicious total" guard
// below). mainFeatures is a dict keyed by opaque codes (CFT2, CFT100, ...) -- matched by
// .label text (pt-BR) rather than by code, since codes aren't documented anywhere.
// generalFeatures (amenities) was empty on every sampled posting -- may just not be populated
// in this feed; amenities extraction here is best-effort and may need revisiting.
//
// Usage:
//   node fetch-imovelweb.js --neighborhoods="Renascença,Itararé" --city=teresina
//     [--min-bedrooms=2 --min-area=50 --max-total=1300]

const { fetchHtml, slugify, parseArgs, extractBalanced, matchesFiltros } = require("./lib.js");

function log(...a) { console.error(...a); }

function extractState(html) {
  const idx = html.indexOf("__PRELOADED_STATE__");
  if (idx === -1) return null;
  const braceIdx = html.indexOf("{", idx);
  if (braceIdx === -1) return null;
  const text = extractBalanced(html, braceIdx);
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { log(`[ImovelWeb] __PRELOADED_STATE__ found but JSON.parse failed: ${e.message}`); return null; }
}

function featureByLabel(mainFeatures, label) {
  if (!mainFeatures || typeof mainFeatures !== "object") return null;
  const f = Object.values(mainFeatures).find((x) => x && x.label === label);
  return f ? f.value : null;
}

function locationChain(loc) {
  // Walk postingLocation.location.parent chain; label tells us the level
  // (BARRIO/ZONA neighborhood-ish, CIUDAD city, PROVINCIA state).
  const chain = [];
  let cur = loc;
  while (cur) { chain.push(cur); cur = cur.parent; }
  const city = chain.find((c) => c.label === "CIUDAD");
  const state = chain.find((c) => c.label === "PROVINCIA");
  const neighborhood = chain[0] !== city ? chain[0] : null;
  return { neighborhood: neighborhood && neighborhood.name, city: city && city.name, state: state && state.acronym };
}

function toCandidate(p) {
  const op = (p.priceOperationTypes && p.priceOperationTypes[0]) || {};
  const price = op.prices && op.prices[0] ? op.prices[0].amount : null;
  const loc = p.postingLocation && locationChain(p.postingLocation.location) || {};
  const geo = p.postingLocation && p.postingLocation.postingGeolocation && p.postingLocation.postingGeolocation.geolocation;
  const pic = p.visiblePictures && p.visiblePictures.pictures && p.visiblePictures.pictures[0];
  const mf = p.mainFeatures;
  return {
    title: p.title || p.generatedTitle || null,
    type: "Casa",
    neighborhood: loc.neighborhood || null,
    city: loc.city || null,
    state: loc.state || null,
    address: p.postingLocation && p.postingLocation.address && p.postingLocation.address.name || "Endereço não informado",
    rent: price, condo: null, condoLabel: "Não informado",
    iptu: p.iptu != null ? Number(p.iptu) : null,
    total: price,
    area: Number(featureByLabel(mf, "Área útil") || featureByLabel(mf, "Área total")) || null,
    bedrooms: Number(featureByLabel(mf, "Quartos")) || null,
    suites: Number(featureByLabel(mf, "Suítes")) || null,
    bathrooms: Number(featureByLabel(mf, "Banheiros")) || null,
    parking: Number(featureByLabel(mf, "Vagas")) || null,
    furnished: null,
    amenities: p.generalFeatures && typeof p.generalFeatures === "object"
      ? Object.values(p.generalFeatures).map((f) => f && f.label).filter(Boolean)
      : [],
    description: p.descriptionNormalized || p.description || null,
    advertiser: p.publisher && p.publisher.name || "Não informado",
    advertiserPhone: p.publisher && (p.publisher.mainPhone || p.publisher.partialPhone) || null,
    photo: pic ? pic.url730x532 : null,
    lat: geo ? geo.latitude : null,
    lng: geo ? geo.longitude : null,
    locationAccuracy: "Coordenadas do anúncio (portal)",
    sources: [{ name: "ImovelWeb", url: p.url ? `https://www.imovelweb.com.br${p.url}` : null, kind: "direct", portalListingId: String(p.postingId) }],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const city = (args.city || "teresina").toLowerCase();
  const filters = {
    neighborhoods: (args.neighborhoods || "").split(",").map((s) => s.trim()).filter(Boolean),
    minBedrooms: args["min-bedrooms"] != null ? Number(args["min-bedrooms"]) : null,
    minArea: args["min-area"] != null ? Number(args["min-area"]) : null,
    maxTotal: args["max-total"] != null ? Number(args["max-total"]) : null,
  };

  const candidates = [];
  for (const hood of filters.neighborhoods) {
    const slug = slugify(hood);
    const url = `https://www.imovelweb.com.br/casas-aluguel-${slug}-${city}.html`;
    const res = await fetchHtml(url);
    if (!res.ok) { log(`[ImovelWeb] bairro "${hood}" (slug=${slug}): HTTP ${res.status}`); continue; }
    const state = extractState(res.text);
    if (!state) { log(`[ImovelWeb] bairro "${hood}": page loaded but state JSON not found`); continue; }
    const postings = state.listStore && state.listStore.listPostings || [];
    const total = state.listStore && state.listStore.paging && state.listStore.paging.total;
    // A bad/unrecognized bairro slug doesn't 404 -- it silently falls back to a
    // nationwide/generic search (seen: "dirceu-teresina" resolved to listings in Atibaia-SP,
    // paging.total in the hundred-thousands). Real single-neighborhood totals here are single
    // or double digits, so treat anything absurdly high as a fallback and skip it.
    if (total > 1000) {
      log(`[ImovelWeb] bairro "${hood}" (slug=${slug}): paging.total=${total} -- suspiciously high, slug likely didn't resolve to this bairro; skipping`);
      continue;
    }
    log(`[ImovelWeb] bairro "${hood}" (slug=${slug}): paging.total=${total}, listPostings=${postings.length}`);
    for (const p of postings) {
      const c = toCandidate(p);
      if (matchesFiltros(c, filters)) candidates.push(c);
    }
  }

  log(`[ImovelWeb] TOTAL: ${candidates.length} passed filters`);
  process.stdout.write(JSON.stringify(candidates, null, 2) + "\n");
}

main().catch((e) => { log("FATAL:", e.message); process.exit(1); });
