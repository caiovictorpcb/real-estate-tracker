#!/usr/bin/env node
"use strict";
// Fetches rental-house candidates from Chaves na Mão. No bot-blocking encountered (plain curl,
// no 429/403). Every page -- bairro list and individual listing alike -- embeds one or more
// <script type="application/ld+json"> blocks; the one we want has "@type":"RealEstateListing"
// either at the top level (list page) or inside a top-level "@graph" array (detail page).
//
// List page: https://www.chavesnamao.com.br/casas-para-alugar/{uf}-{city}/{bairro-slug}/
//   -> RealEstateListing.offers.numberOfItems is the AUTHORITATIVE count of real matches for
//      that bairro. offers.itemListElement is padded to ~15 with "similar" filler listings from
//      OTHER neighborhoods, so filter by itemOffered.address.addressLocality, don't trust the
//      array length. Each element already has price/area/bathrooms/address/geo/url/advertiser
//      name -- enough to build the listing URL set, but not phone/amenities/full description.
// Detail page: https://www.chavesnamao.com.br/imovel/{slug}/id-{portalListingId}/
//   -> the @graph RealEstateListing node's .about.offers has itemOffered (full address, geo,
//      amenityFeature[], petsAllowed, numberOfBathroomsTotal) and offeredBy (agent name,
//      telephone, their chavesnamao profile url -- NOT their own site).
// Quirk (confirmed live 20/08/2026): itemOffered.numberOfBedrooms / numberOfRooms are unreliable
// (seen as "0" on a listing whose free-text description said "02 Quartos") -- always cross-check
// bedroom count against the free-text description first, fall back to the JSON field only if the
// description doesn't mention a count.
//
// Usage:
//   node fetch-chavesnamao.js --neighborhoods="Renascença,Itararé" --uf=pi --city=teresina
//     [--min-bedrooms=2 --min-area=50 --max-total=1300]

const { fetchHtml, slugify, parseArgs, matchesFiltros, stripAccentsLower } = require("./lib.js");

function log(...a) { console.error(...a); }

function extractJsonLdBlocks(html) {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1])); } catch { /* skip malformed block */ }
  }
  return out;
}

// Works on both list pages (top-level @type) and detail pages (@type nested in @graph[]).
function findRealEstateListing(html) {
  for (const block of extractJsonLdBlocks(html)) {
    if (block["@type"] === "RealEstateListing") return block;
    if (Array.isArray(block["@graph"])) {
      const hit = block["@graph"].find((n) => n["@type"] === "RealEstateListing");
      if (hit) return hit;
    }
  }
  return null;
}

function localityMatches(locality, hood) {
  const a = stripAccentsLower(locality || "");
  const b = stripAccentsLower(hood);
  if (!a || !b) return false;
  return a === b || a.startsWith(b + ",") || a.startsWith(b + " ");
}

function extractCount(text, re) {
  if (!text) return null;
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}
const BEDROOM_RE = /(\d+)\s*quartos?\b/i;
const PARKING_RE = /(\d+)\s*vagas?\b/i;

function idFromUrl(url) {
  const m = (url || "").match(/\/id-(\d+)\/?$/);
  return m ? m[1] : null;
}

function toCandidate(node) {
  const offer = node.about && node.about.offers;
  const item = offer && offer.itemOffered;
  const address = item && item.address;
  const geo = item && item.geo;
  const agent = offer && offer.offeredBy;
  const url = (offer && offer.url) || node.url || (node["@id"] || "").replace(/#listing$/, "");
  const description = node.description || (offer && offer.description) || "";
  const rent = offer && Number(offer.price) || null;

  const amenities = ((item && item.amenityFeature) || [])
    .filter((f) => f.value === true)
    .map((f) => f.name);
  if (item && item.petsAllowed === true) amenities.push("Aceita pets");

  const bedroomsFromJson = item && item.numberOfBedrooms != null ? Number(item.numberOfBedrooms) : null;
  const bedrooms = extractCount(description, BEDROOM_RE) ?? (bedroomsFromJson || null);
  const parking = extractCount(description, PARKING_RE);

  const streetAddress = address && address.streetAddress;
  const locality = address && address.addressLocality;
  const neighborhood = locality ? locality.split(",")[0].trim() : null;

  return {
    title: node.name || null,
    type: "Casa",
    neighborhood,
    city: "Teresina",
    state: "PI",
    address: streetAddress || "Endereço não informado",
    rent,
    condo: null,
    condoLabel: "Não informado",
    iptu: null,
    total: rent,
    area: item && item.floorSize ? Number(item.floorSize.value) : null,
    bedrooms,
    suites: null,
    bathrooms: item && item.numberOfBathroomsTotal != null ? Number(item.numberOfBathroomsTotal) : null,
    parking,
    furnished: null,
    amenities,
    description: description || null,
    advertiser: (agent && agent.name) || "Não informado",
    advertiserPhone: (agent && agent.telephone) || null,
    photo: (node.about && node.about.image && node.about.image[0]) || null,
    lat: geo && geo.latitude != null ? Number(geo.latitude) : null,
    lng: geo && geo.longitude != null ? Number(geo.longitude) : null,
    locationAccuracy: geo ? "Coordenadas do anúncio (portal)" : null,
    sources: [{ name: "Chaves na Mão", url, kind: "direct", portalListingId: idFromUrl(url) }],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uf = (args.uf || "pi").toLowerCase();
  const city = (args.city || "teresina").toLowerCase();
  const filters = {
    city: "teresina",
    neighborhoods: (args.neighborhoods || "").split(",").map((s) => s.trim()).filter(Boolean),
    minBedrooms: args["min-bedrooms"] != null ? Number(args["min-bedrooms"]) : null,
    minArea: args["min-area"] != null ? Number(args["min-area"]) : null,
    maxTotal: args["max-total"] != null ? Number(args["max-total"]) : null,
  };

  const urls = new Set();
  for (const hood of filters.neighborhoods) {
    const slug = slugify(hood);
    const listUrl = `https://www.chavesnamao.com.br/casas-para-alugar/${uf}-${city}/${slug}/`;
    const res = await fetchHtml(listUrl);
    if (!res.ok) { log(`[Chaves na Mão] bairro "${hood}" (slug=${slug}): HTTP ${res.status}`); continue; }
    const listing = findRealEstateListing(res.text);
    if (!listing || !listing.offers) { log(`[Chaves na Mão] bairro "${hood}" (slug=${slug}): no RealEstateListing JSON-LD found`); continue; }
    const total = listing.offers.numberOfItems || 0;
    const items = (listing.offers.itemListElement || []).filter((el) => {
      const loc = el.itemOffered && el.itemOffered.address && el.itemOffered.address.addressLocality;
      return localityMatches(loc, hood);
    });
    log(`[Chaves na Mão] bairro "${hood}" (slug=${slug}): numberOfItems=${total}, ${items.length} matched after de-padding`);
    items.forEach((el) => { if (el.url) urls.add(el.url); });
  }

  const candidates = [];
  let fetched = 0, parseFailed = 0;
  for (const url of urls) {
    const res = await fetchHtml(url);
    if (!res.ok) { log(`[Chaves na Mão] listing fetch failed (${res.status}): ${url}`); continue; }
    const node = findRealEstateListing(res.text);
    if (!node) { parseFailed++; log(`[Chaves na Mão] could not parse RealEstateListing for: ${url}`); continue; }
    fetched++;
    const c = toCandidate(node);
    if (matchesFiltros(c, filters)) candidates.push(c);
  }

  log(`[Chaves na Mão] TOTAL: ${urls.size} unique listing(s), ${fetched} fetched ok (${parseFailed} parse failures), ${candidates.length} passed filters`);
  process.stdout.write(JSON.stringify(candidates, null, 2) + "\n");
}

main().catch((e) => { log("FATAL:", e.message); process.exit(1); });
