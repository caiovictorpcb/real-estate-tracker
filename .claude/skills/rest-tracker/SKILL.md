---
name: rest-tracker
description: Regenerates the rest-tracker property-search HTML app (Teresina imóveis) by re-reading the FILTROS block in idea.md, re-searching real estate portals, deduping listings, and rendering a new timestamped index-*.html. Use when the user asks to "regenerate", "refresh", "atualizar", or "re-run" the rest-tracker / imóveis search in this project, or after editing the FILTROS block in idea.md.
---

# Rest Tracker

Regenerates the property-search app in this folder. Reads current filters from `idea.md`, searches portals, dedupes, and renders a new self-contained HTML file. Full instructions for the search/collect/dedupe/render pipeline live in `idea.md` in this project root — read it first, every run. This skill is the reusable wrapper around that pipeline; it does not replace it.

## Quick start

1. Read `idea.md` → the `FILTROS` code block. If any field is empty or ambiguous, ask the user before searching — do not guess criteria.
2. Find the most recent `index*.html` in this folder (`index.html` or the latest `index-YYYY-MM-DD.html`) and use it as the template baseline — see "Template baseline" below.
3. Read `advertisers.json` in this folder if it exists (empty registry if not) — see "Advertiser registry" below.
4. Fetch portal candidates — scripted portals run directly via Bash, no subagent; only unscripted portals get a subagent (see "Portal search").
5. Collect, filter, dedupe, geocode-by-neighborhood — see [REFERENCE.md](REFERENCE.md) for the exact field schema and dedupe rule.
6. Enrich and update the advertiser registry (see "Advertiser registry").
7. Render a new file named `index-YYYY-MM-DD.html` (today's date; if run twice same day, append `-2`, `-3`, ...). Never overwrite an existing timestamped file.
8. Report an honest summary and the localStorage caveat (below).

## Template baseline

Don't rebuild the HTML/CSS/JS shell from memory or from idea.md's spec text — read the actual most recent `index-*.html` file in the folder and reuse its `<style>`, layout, and JS engine (rendering, localStorage marks-by-ID, Leaflet map, detail dialog) as-is. This preserves any manual tweaks the user made between runs. The only things that change per run are:
- the `LISTINGS` array (or `listings.js` content in split mode)
- the header `.search-summary` text (should reflect the current FILTROS)
- the "Atualizado" date in `.verified`

If no prior `index*.html` exists, build fresh per idea.md's step 5 spec.

## Portal search

**Run the scripts directly — no subagent, no LLM tokens spent on HTML.** `scripts/` has deterministic Node fetchers for the portals that have been reverse-engineered (recipes documented in [REFERENCE.md](REFERENCE.md) → "Portal scripts"):

```
node scripts/fetch-grupozap.js --portal=zap       --neighborhoods="<from FILTROS>" --state=pi --city=teresina --min-bedrooms=N --min-area=N --max-total=N
node scripts/fetch-grupozap.js --portal=vivareal  --neighborhoods="<from FILTROS>" --state=pi --city=teresina --min-bedrooms=N --min-area=N --max-total=N
node scripts/fetch-olx.js                         --neighborhoods="<from FILTROS>" --uf=pi --city=teresina    --min-bedrooms=N --min-area=N --max-total=N
node scripts/fetch-imovelweb.js                   --neighborhoods="<from FILTROS>" --city=teresina            --min-bedrooms=N --min-area=N --max-total=N
node scripts/fetch-chavesnamao.js                 --neighborhoods="<from FILTROS>" --uf=pi --city=teresina    --min-bedrooms=N --min-area=N --max-total=N
```

Each prints diagnostics to stderr (which bairros resolved, which fell back or 404'd, counts at each stage) and a JSON array of already-filtered candidates to stdout, in the field schema from REFERENCE.md. Run all five (they're independent — fine to run as separate Bash calls back to back, or backgrounded), read back the JSON, and check stderr for anything worth surfacing in the final summary (a portal returning 0 everywhere, a bairro slug that 404'd or silently fell back).

**Any portal FILTROS names that has no script yet** (any portal the user adds later that isn't one of the five above) — launch one `general-purpose` subagent for it, same brief as before: full FILTROS block, its one portal, extract the REFERENCE.md field schema, capture advertiser name + phone, space out requests and proceed past 429/403s. **Additionally ask it to report back, in its final message, the URL pattern and JSON-extraction recipe it found** (which embedded state variable, which script tag, which URL scheme worked) if one exists — that's exactly what turned ZAP/Viva Real/OLX/ImovelWeb/Chaves na Mão into scripts, and it's how the next unscripted portal gets scripted too instead of re-paying full agentic exploration cost every run. If FILTROS lists multiple unscripted portals, launch them in parallel (independent work, no shared state).

Collect everything (script output + any subagent reports) before deduping — don't dedupe streaming/partial results.

## Advertiser registry

`advertisers.json` accumulates across runs (unlike listings, which are a full refresh each time) — it's the durable memory of who's a repeat agent/imobiliária and whether they have their own site worth treating as a future source. Schema and merge rules are in [REFERENCE.md](REFERENCE.md).

After deduping listings, for each unique advertiser name that appears:
1. Normalize the name and look it up in the registry loaded in step 3.
2. If already registered with a `website`, skip searching — just bump `lastSeen` and add today's portal to `portalsSeen` if new.
3. If not registered, or registered but `website` is still `null`, do one targeted WebSearch (e.g. `"<name>" imobiliária <city>` or `"<name>" corretor imóveis`) to see if they have their own site. Register what's found — name, phone(s) (from each candidate's `advertiserPhone`, populated by the fetch scripts or the unscripted-portal subagent), website (or `null` if none found), portals seen, first/last seen.
4. **Register only — do not fetch/scrape the discovered website this run.** That's a separate, deliberate step the user opts into per agent later.

Write the updated registry back to `advertisers.json`, preserving all pre-existing entries (merge, never overwrite the whole file).

## After rendering

Report to the user:
- how many unique listings made it in, how many have 2+ sources
- which portals worked vs. got blocked
- how many new advertisers were registered this run, and how many now have a known website in `advertisers.json` (these are candidates the user might want scraped as a source in a future run)
- reminder about pin accuracy: ZAP/Viva Real/OLX candidates carry the portal's own listing coordinates (`locationAccuracy: "Coordenadas do anúncio (portal)"`) — these are the advertiser's pin placement, not a verified exact address, but they're portal-sourced, not guessed. Only listings from a portal/subagent that didn't supply coordinates fall back to neighborhood-centroid + jitter (label that honestly per REFERENCE.md) — say which kind you used
- **localStorage caveat**: marks (Visitar/Intenção/Descartar) are saved under a fixed key, scoped to the browser's origin for `file://` pages. Chrome shares one `file://` origin across local files, so marks usually carry over automatically to the new timestamped file — Firefox scopes origin per file path, so marks will NOT carry over there. If the user relies on Firefox or wants guaranteed continuity, offer to also refresh `index.html` (the stable name) to match, or ask before doing so — don't do it silently, this project uses timestamped output by design.

Don't invent listings, prices, or coordinates. Mark estimated vs. confirmed fields honestly, per idea.md's honesty rules.
