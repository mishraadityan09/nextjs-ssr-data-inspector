# Changelog

All notable changes to this extension are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-06-15

### Changed

- Redesigned the panel into a **Network-tab–style** UI: a sortable columnar
  table (Name · Method · Status · Size · Time) with **waterfall bars** and row
  selection, plus a **resizable split detail pane** with **Headers / Response /
  Timing** tabs. Response has a **Tree ⇄ Raw** toggle and **Copy JSON**.
- Added 3xx / 4xx / 5xx status filters and a size+time summary.

## [0.1.0] — 2026-06-15

### Added

- Initial release: **SSR Data** DevTools panel that reads a server-side fetch
  log embedded in the page (`#__ssr_data` by default) and renders it.
- Collapsible, syntax-highlighted JSON tree with expand/collapse all.
- Filter by URL and by status (all / 2xx / non-2xx / errors).
- Per-call row: method, path, status pill, **response size**, duration, time,
  Copy JSON.
- **Color-coded HTTP methods** (GET/POST/PUT/PATCH/DELETE) and **status
  buckets** (2xx / 3xx / 4xx / 5xx).
- **Request & response headers** view (redact secrets app-side before emitting).
- Summary line (matched/total calls + total server time).
- **Configurable element id** via the ⚙ gear, persisted in `chrome.storage.local`.
- **Auto-detection** of the page's SSR-data element: matching
  `<script type="application/json">` ids are discovered and offered by name, so
  first-time users don't need to know the id.
- **Customizable colors** for methods and status buckets — color pickers in ⚙,
  persisted, with Reset to theme defaults.
- Auto light/dark theme matching DevTools.
- Zero host permissions; reads only the inspected page.
