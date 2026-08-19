# Listing field schema & dedupe rule

## Field schema (one object per unique listing, in the `LISTINGS` array)

```
id            string  — stable slug, e.g. 'zap-2903809004' (portal + portal-native id when available,
                          else a slug from neighborhood+area+price). Must stay stable across runs so
                          localStorage marks (keyed by id) keep matching the same listing.
title         string  — short human title
type          string  — property type (matches FILTROS "Tipo de imóvel")
neighborhood  string
city          string
state         string  — UF, e.g. 'PI'
address       string  — whatever the listing gives; 'Endereço não informado' if none
rent          number  — monthly rent (or purchase price if FILTROS objetivo = comprar)
condo         number|null
condoLabel    string  — e.g. 'isento', 'não informado', or the raw condo text
iptu          number|null
total         number  — rent + condo (the figure filtered against FILTROS max total)
area          number  — m²
bedrooms      number
suites        number|null
bathrooms     number
parking       number
furnished     string|null
amenities     string[]
description   string  — 1-3 sentences, only facts actually stated in the source(s)
advertiser    string  — 'Não informado' if the listing page didn't show one
advertiserPhone string|null — only if visible without a click-to-reveal action; else null, don't guess
photo         string|null — direct image URL if found (will be tried with referrerpolicy=no-referrer
                          and fall back to the generated SVG cover on error)
lat, lng      number  — prefer the portal's own listing coordinates when the source provides them
                          (ZAP/Viva Real/OLX all do — see "Portal scripts" below); only fall back to
                          neighborhood centroid + small jitter (~100-300m) when nothing better exists
locationAccuracy string — 'Coordenadas do anúncio (portal)' when using portal-supplied coordinates,
                          'Centro aproximado do bairro' when using centroid+jitter fallback
verifiedAt    string  — today's date, dd/mm/yyyy
sources       array of {name, url, kind} — kind is 'direct' (individual listing page) or
                          'category' (search/category page, when the direct page couldn't be reached)
```

## Dedupe rule

Two candidates are the same listing if they match on:
- same city + neighborhood, AND
- area within ±3–5 m², AND
- total price within ±5%

...or if they share the same portal-native listing ID across two mirrored listings (rare, but some portals re-list the same id).

When merged, keep the most complete field values across all matching candidates (prefer confirmed over null, prefer the direct listing page's data over category-page guesses) and union all `sources` entries — never publish the same physical listing twice.

## Neighborhood centroid coordinates (fallback only)

ZAP, Viva Real, and OLX all supply real listing coordinates directly (`address.coordinates` / `location.mapLati,mapLong` in their embedded data — see "Portal scripts" below), so `scripts/fetch-*.js` already fills `lat`/`lng` from that for anything those portals return. Only fall back to a centroid when a source genuinely has no coordinates (e.g. an unscripted portal an agent is handling manually, or ImovelWeb once verified): get the neighborhood's approximate center once per run (one WebSearch per distinct neighborhood, cached across listings in that neighborhood this run) and apply a small random jitter (~0.001–0.003°) per listing so pins in the same neighborhood don't stack exactly on top of each other. Label honestly in `locationAccuracy`.

## Portal scripts (`scripts/`)

Deterministic Node fetchers, built and verified live against real listings during this skill's development (see SKILL.md → "Portal search" for how they're invoked). All of them shell out to `curl` for the actual HTTP request — Node's own `fetch()` gets 403'd by these portals' bot-detection (almost certainly a TLS/HTTP2 fingerprint check) even with an identical User-Agent header; curl isn't flagged the same way. This is `lib.js`'s `fetchHtml()` — don't "simplify" it back to `fetch()`, it will silently start failing.

- **`fetch-grupozap.js`** (`--portal=zap|vivareal`) — ZAP Imóveis and Viva Real share the same backend/schema (same company). Data is a Next.js RSC stream: `self.__next_f.push([1,"<escaped json>"])` chunks that concatenate into one string containing a `"listings":[...]` array (JSON.parse the unescaped chunk, bracket-match the array). Each listing has real `address.coordinates`, full `advertiser.phoneNumbers[]`, and `amenities.values[]` as opaque codes (translated via `translateAmenity()` in lib.js). Bairro URL: `https://www.zapimoveis.com.br/aluguel/casas/{uf}+{city}++{slug}/` (ZAP) or `https://www.vivareal.com.br/aluguel/{uf-full-name}/{city}/bairros/{slug}/casa_residencial/` (Viva Real, needs full state name — `STATE_NAMES` map in the script). A 404 on the bairro URL means the slug isn't recognized (confirmed for Dirceu, Parque Ideal on both) — falls back to paginated city-wide search (`?pagina=N`, 30/page) filtered client-side by neighborhood name.
- **`fetch-olx.js`** — the bairro search page (`https://www.olx.com.br/imoveis/aluguel/casas/estado-{uf}/{region}/{city}/{slug}`) is plain server-rendered HTML with `<a href>` links to individual listings, no JSON needed there. Each individual listing embeds full data in `<script id="initial-data" type="text/plain" data-json="<html-entity-escaped json>">` — decode entities, JSON.parse, read `.ad.*` (properties array keyed by `name`: `size`, `rooms`, `bathrooms`, `garage_spaces`, `condominio`, `re_features`, `re_complex_features`; `.location.mapLati/mapLong` for coordinates). **Known quirk**: some bairro slugs (confirmed: Dirceu) don't actually filter — OLX returns 200 with an unfiltered/generic result set instead of 404ing. The script detects this by result count (≥20 links is suspicious for a single bairro here) and caps how many individual pages it fetches rather than burning ~50 requests on mostly-wrong candidates.
- **`fetch-imovelweb.js`** — `window.__PRELOADED_STATE__ = {...}` (plain JSON, not RSC-escaped) at `data.listStore.listPostings[]` / `data.listStore.paging.total`. Bairro URL: `https://www.imovelweb.com.br/casas-aluguel-{slug}-{city}.html`. **Known quirk**: an unrecognized slug doesn't 404 either — it silently falls back to a nationwide search (confirmed: `dirceu-teresina` resolved to listings in Atibaia-SP, `paging.total` in the hundreds of thousands). The script treats `paging.total > 1000` as that fallback and skips it. `mainFeatures` is a dict keyed by opaque codes (`CFT2`, `CFT100`, ...) — matched by `.label` text (pt-BR: "Quartos", "Banheiros", "Área útil", ...) since the codes aren't documented anywhere. **Caveat**: field mapping was verified against a real posting object, but never against an actual Dirceu/Itararé/Parque Ideal/Renascença listing (zero existed there during development) — if this script starts returning candidates with obviously wrong fields, check the mapping against a live one first.
- **Chaves na Mão has no script** — small/older site, no bot-blocking encountered, cheap enough agentically (no embedded JSON found; not worth the investment yet). Stays on the subagent path in SKILL.md.

**When a subagent handles an unscripted portal and finds a working recipe** (URL pattern + where the data lives), that's exactly the kind of finding that should turn into a fifth script here — don't let it evaporate at the end of a run.

## Advertiser registry (`advertisers.json`)

Durable across runs — not part of the per-run listings refresh. Shape:

```json
{
  "advertisers": [
    {
      "name": "Imobiliária Exemplo",
      "normalizedName": "imobiliaria exemplo",
      "phones": ["(86) 9xxxx-xxxx"],
      "website": "https://imobiliariaexemplo.com.br",
      "portalsSeen": ["ZAP Imóveis", "OLX"],
      "firstSeen": "2026-08-19",
      "lastSeen": "2026-08-19",
      "notes": ""
    }
  ]
}
```

- `normalizedName`: lowercase, accents stripped, whitespace collapsed — used to match the same advertiser across portals/runs despite minor spelling variants (e.g. "Imobiliária Exemplo" vs "IMOBILIARIA EXEMPLO LTDA"). If unsure whether two names are the same entity, treat them as separate entries rather than guessing a merge.
- `phones`: array, dedupe exact matches, append newly-seen numbers instead of overwriting.
- `website`: `null` until a run's targeted WebSearch (see SKILL.md → "Advertiser registry") finds one with reasonable confidence (the site should clearly belong to that name/city, not just any real-estate site). Never invent a URL.
- `portalsSeen`: union across runs, don't dedupe away history.
- `firstSeen` / `lastSeen`: dd/mm/yyyy or ISO, be consistent within the file.
- This file is a lead list, not a source list — nothing in it is fetched automatically. Scraping a discovered `website` only happens when the user explicitly asks for that advertiser.

## FILTROS → filtering checklist

Reject any candidate that fails any of these (all must be read from the current `idea.md` FILTROS block, not assumed from a prior run):
- Objetivo (alugar/comprar) matches
- Tipo de imóvel matches
- City/region and (if specified) neighborhood list matches
- bedrooms >= minimum
- area >= minimum
- total (rent+condo, or purchase price) <= maximum
- advertiser not in the exclusion list — open the individual listing page if the search results page doesn't show the advertiser name
- any "Outros requisitos" from FILTROS
