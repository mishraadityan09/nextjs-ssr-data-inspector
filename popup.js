// Show the currently configured element id (shared with the panel via
// chrome.storage.local). Purely informational — the panel owns editing.
const DEFAULT_ID = "__ssr_data";

if (chrome.storage && chrome.storage.local) {
  chrome.storage.local.get({ elementId: DEFAULT_ID }, function (cfg) {
    const el = document.getElementById("elId");
    if (el) el.textContent = cfg.elementId || DEFAULT_ID;
  });
}
