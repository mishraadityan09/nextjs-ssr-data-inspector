// Registers the "SSR Data" DevTools panel that renders the server-side fetch
// log a Next.js / SSR app embeds in the page (default element id: __ssr_data).
chrome.devtools.panels.create(
  "SSR Data",
  "icons/128.png",
  "panel.html",
  function () {}
);
