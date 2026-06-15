# Privacy Policy — Next.js SSR Data Inspector

**This extension collects no data.**

- It makes **no network requests** of its own.
- It requests **no host permissions** and cannot read arbitrary websites. It
  only reads the page currently open in DevTools, on demand, via
  `chrome.devtools.inspectedWindow.eval`.
- The only data it stores is a single preference — the DOM element id to read
  (default `__ssr_data`) — kept locally in `chrome.storage.local`. This never
  leaves your machine.
- Nothing is transmitted to the author or any third party. There are no
  analytics, no trackers, no remote code.

The extension is intended for **local development**. The data it displays is
whatever your own app embeds in the page during development. In the reference
integration, sensitive request/response headers (auth, cookies, API keys) and
secret URL query params are **redacted by the app** before anything is embedded.

_Last updated: 2026-06-15._
