# Next.js SSR Data Inspector

A lightweight, **dev-only** Chrome DevTools extension that shows the JSON your
app fetched **on the server** — the data behind Next.js **Server Components /
SSR / Server Actions** that never appears in the browser **Network** tab.

> The blind spot it fills: server-side fetches happen in Node, so DevTools →
> Network only shows the HTML document. React Query / Redux DevTools only see
> *client* state. This surfaces the *server* fetches.

**Zero permissions.** It requests **no host permissions** and makes **no
network calls** — it only reads the page currently open in DevTools, via
`chrome.devtools.inspectedWindow.eval`.

## Who it's for

- **Next.js / SSR developers** — verify "did the server fetch the right JSON,
  with what status & timing?" without `console.log` spam or re-running calls in
  Postman.
- **Full-stack devs wiring a CMS/backend** — confirm content shape per page.
- **QA engineers** — see which upstream calls a page made and their responses.
- **Any SSR framework** (Remix, SvelteKit, Astro, …) that can emit the contract
  below — the extension is framework-agnostic.

## How it works — the contract

Your app, **in development only**, embeds a JSON log of its server-side fetches
into the page:

```html
<script type="application/json" id="__ssr_data">
  [
    { "method": "GET", "url": "https://api.example.com/x", "status": 200,
      "ok": true, "durationMs": 142, "ts": 1718000000000, "size": 4821,
      "reqHeaders": { }, "resHeaders": { }, "body": { } },
    { "method": "POST", "url": "…", "status": 0, "ok": false,
      "durationMs": 51, "error": "TimeoutError" }
  ]
</script>
```

Each entry:
`{ method, url, status, ok, durationMs, ts?, size?, reqHeaders?, resHeaders?, body?, error? }`.
The element id is **configurable** (default `__ssr_data`) — set it via the ⚙
gear if your app uses a different id.

## Install (load unpacked)

1. Run your app in dev mode.
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select this folder (`nextjs-ssr-data-inspector`).
4. Open a server-rendered page, open DevTools, and pick the **SSR Data** tab
   (check the `»` overflow). It auto-refreshes on navigation; **↻** reloads.

## Features

- **URL, method, status, duration, and response size** at a glance
- **Color-coded methods** (GET / POST / PUT / PATCH / DELETE) and **status
  buckets** (2xx / 3xx / 4xx / 5xx) — **fully customizable** via color pickers (⚙)
- **Request & response headers** (redact secrets app-side before emitting)
- Collapsible, **syntax-highlighted JSON** bodies (expand/collapse all)
- Filter by URL; filter by status; **Copy JSON** per call; summary line
- **Auto-detects** the page's SSR-data element — first run needs no setup; if
  your app uses a different id it's offered **by name** (no guessing)
- **Configurable element id** (⚙), persisted via `chrome.storage.local`
- **Refresh** re-reads the latest server render; **auto-refresh** on full
  navigation
- Auto light / dark theme (matches DevTools)

> **Scope of Refresh:** it reflects the page's **server render** — the initial
> load plus RSC navigations to other server-rendered routes. Post-load **server
> actions, route handlers, and revalidations** run in separate requests and are
> not re-embedded into the loaded page, so they won't appear.

## Customize

- **⚙ Element id** — point the panel at whatever id your app emits.
- **⚙ Colors** — recolor every method and status bucket with the color pickers;
  changes persist (`chrome.storage.local`). **Reset** restores theme defaults.

## Integrate it in your app

Emit the contract above in development. A minimal Next.js sketch:

```jsx
// A server component rendered LAST on the page (so all fetches are done).
export default function SsrDataScript({ entries }) {
  if (process.env.NODE_ENV === "production") return null;
  const json = JSON.stringify(entries).replace(/</g, "\\u003c");
  return (
    <script
      type="application/json"
      id="__ssr_data"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
```

Record each server fetch (method, url, status, durationMs, size, headers, body)
into a per-request list and pass it in. **Redact** sensitive headers
(`Authorization`, `Cookie`, `Set-Cookie`, API keys) and secret URL params before
embedding. Gate the whole thing to non-production.

Already emitting under a different id? Just set it via the ⚙ gear — no code
change needed.

## Notes

- Data should be present in **non-production** builds only (gate the emitter on
  `NODE_ENV !== "production"`).
- Cap large bodies app-side (e.g. store `{ "__truncated": true, "length": N }`).
- Request **bodies** are best left uncaptured (avoids embedding PII).

## Build a distributable zip

```bash
bash package.sh   # → dist/nextjs-ssr-data-inspector-<version>.zip
```

## Author

An independent, open-source tool built by **Aditya Mishra** —
[github.com/mishraadityan09](https://github.com/mishraadityan09).

## License

[MIT](./LICENSE) © Aditya Mishra.
