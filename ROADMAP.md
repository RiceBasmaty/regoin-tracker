# Roadmap

The plan approved by Dmitry on 2026-11-14. The details of each finished phase live in `DECISIONS.md`.

| Phase | Status |
|---|---|
| 0. Data pipeline | ✅ done |
| 1. Map shell | ✅ done |
| 2. Add a city | ✅ done |
| 3. Progress and polish | next |
| 4. Deploy and harden | planned |
| 5. Accounts and sync | later |

## Phase 2: Add a city
- **Search bar:** suggestions from the 2nd character. Arrow keys move, Enter picks, Esc closes. Empty and offline results get polite messages.
- **Picking a city:**
  - it's saved on the device (IndexedDB);
  - the camera flies to it and a dot appears;
  - its region fills with the visited colour;
  - its country gets a **light outline** (approved);
  - a confirmation appears: **"Added Paris · Undo"** (approved).
- **Picking a city that's already saved** only flies to it; it's never duplicated.
- **Colours:** keep the current colours (approved). The token system is split into a raw *palette* and named *roles*, so a future design system only replaces the palette.
- **Robustness:** open tabs stay in sync. Saved cities are re-checked against new map data when the data version changes.

## Phase 3: Progress and polish
- **"My cities" panel:** search, sort, and delete with undo.
- **A very small counter** on the map, e.g. "42 cities · 12 countries · 57 regions" (approved). A dedicated stats page comes after launch: timeline, single-country view, trips. Per-country counters come with accounts.
- **Export and import** of your list as a file. Imported cities are added to the list, and duplicates are skipped.
- **Flags in the region card:**
  - country flags from an MIT-licensed SVG set;
  - region flags from Wikidata/Wikimedia Commons where the licence allows, with the region's country flag as fallback;
  - the pipeline records each flag's licence and cleans the files.
- **Accessibility pass** (keyboard, screen readers) and an "About & credits" panel.

## Phase 4: Deploy and harden (free tier, no domain yet)
- **Hosting on free Cloudflare plans:** Pages for the app, R2 for the data, and a Worker serving tiles as plain cached URLs. The site uses Cloudflare's free `*.pages.dev` address until a domain is bought.
- **Error logging** with our own tiny endpoint on that Worker (decided in D29: free, private, no third party).
- **Security:** security headers (CSP), rate limits, and DDoS protection from the CDN.
- **Upkeep:** automated tests on every change (GitHub Actions), a one-command data upload, and a final performance check.
- **Costs:** anything that would cost money gets asked about first.

## Phase 5: Accounts and sync (later)
- Supabase sign-in and sync, per-country counters, "download my data" and "delete my account". Details to be discussed.
