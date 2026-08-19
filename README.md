# Rest Tracker

Prefere ler o readme em português? [README.pt-BR.md](README.pt-BR.md)

A real-estate search tracker driven by an AI coding agent: describe what you're looking for in plain filters, and the agent searches real estate portals, dedupes listings across them, and renders a single self-contained HTML app to browse and mark the results. Not tied to any one city — clone it, edit the filters, point it wherever you're house-hunting.

Inspired by [this gist](https://gist.github.com/brunobertolini/6c319951db004b8e1d9c4752afc7f6ba).

## How it works

1. Clone this repo and edit the `FILTROS` block in [`idea.md`](idea.md) — objective (rent/buy), property type, city/state/neighborhoods, min bedrooms/area, max total price, exclusions, etc. There's nothing Teresina-specific about the mechanism; it's just what this repo's `idea.md` happens to be set to right now — change the city/state and the same pipeline runs against wherever you point it.
2. Ask your coding agent (this was built with Claude Code) to "regenerate" / "refresh" the tracker — that invokes the `rest-tracker` skill in `.claude/skills/`.
3. Get a new `index-YYYY-MM-DD.html` — open it in a browser, no server needed.

Re-running never overwrites a previous `index-*.html`; each run produces a new timestamped file.

```mermaid
flowchart TD
    A["idea.md<br/>FILTROS block"] --> B["rest-tracker skill"]
    B --> C1["fetch-grupozap.js<br/>--portal=zap"]
    B --> C2["fetch-grupozap.js<br/>--portal=vivareal"]
    B --> C3["fetch-olx.js"]
    B --> C4["fetch-imovelweb.js"]
    B --> C5["subagent<br/>(unscripted portals,<br/>e.g. Chaves na Mão)"]

    C1 --> D["Collect candidates"]
    C2 --> D
    C3 --> D
    C4 --> D
    C5 --> D

    D --> E["Dedupe across portals<br/>+ merge sources"]
    E --> F["Update advertiser registry<br/>(advertisers.json)"]
    E --> G["Render index-YYYY-MM-DD.html"]

    F -.persists across runs.-> F
    G --> H(["Open in browser<br/>list + map, marks in localStorage"])
```

## Files

| Path | What it is |
|---|---|
| `idea.md` | The filter criteria (`FILTROS` block) and the original search/build spec — this is the file you edit to point the tracker at your own city and preferences |
| `index-YYYY-MM-DD.html` | Generated output — self-contained property browser (list + map). Not committed by default; regenerate as needed |
| `advertisers.json` | Persistent registry of advertisers/imobiliárias seen across runs — name, phone, own website if found. Accumulates over time, unlike listings |
| `.claude/skills/rest-tracker/` | The Claude Code skill that drives regeneration — see below |

## The app (`index-*.html`)

- Airbnb-style layout: listing sidebar + Leaflet/OpenStreetMap map (desktop split, mobile toggle), light/dark theme
- Each listing shows all portals it was found on, with links to every source
- Mark listings **🏠 Visitar / ⭐ Intenção / ✕ Descartar**, with notes — saved to `localStorage` keyed by listing ID, so regenerating the data doesn't wipe your marks
- Top filters: unmarked (inbox, default), Intenção, Visitar, Descartados, Todos
- Cover images are always generated locally (SVG) as a fallback; real portal photos are attempted on top and fall back cleanly if blocked
- Map pins use the portal's own listing coordinates when available (ZAP/Viva Real/OLX all provide these); only fall back to an approximate neighborhood centroid when a source doesn't supply coordinates — labeled honestly either way

**Caveat:** marks are scoped to the browser's `file://` origin. Chrome shares one origin across local files, so marks usually carry over to a new timestamped file automatically; Firefox scopes by file path and won't carry them over.

## The skill (`.claude/skills/rest-tracker/`)

- `SKILL.md` — the regeneration workflow: read filters → search portals → dedupe → update advertiser registry → render → report
- `REFERENCE.md` — listing field schema, dedupe rule, advertiser registry schema, and the portal-scraping recipes
- `scripts/` — deterministic Node fetchers for ZAP Imóveis, Viva Real, OLX, and ImovelWeb (no LLM tokens spent scraping HTML; portals without a script yet fall back to an agentic search). Each shells out to `curl` rather than Node's own `fetch()`, since these portals block Node's fetch fingerprint but not curl's.

Portals currently covered: ZAP Imóveis, Viva Real, OLX, ImovelWeb (all scripted), Chaves na Mão (agentic, no script yet).

## Honesty rules

Never invented: listings, prices, or coordinates. Anything estimated (condo fee, location accuracy) is labeled as such rather than presented as confirmed. If a portal blocks access, that's reported rather than silently skipped.
