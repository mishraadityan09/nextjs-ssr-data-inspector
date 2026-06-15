// Reads the SSR fetch log a Next.js / SSR app embeds in the inspected page
// (a <script type="application/json" id="…"> holding an array of
// { method, url, status, ok, durationMs, ts?, body?, error? }) and renders it
// as a filterable, collapsible, syntax-highlighted tree.
//
// Uses chrome.devtools.inspectedWindow.eval, so the extension needs no host
// permissions — it only ever reads the page currently open in DevTools.

const DEFAULT_ID = "__ssr_data";

const els = {
  root: document.getElementById("root"),
  summary: document.getElementById("summary"),
  filter: document.getElementById("filter"),
  statusFilter: document.getElementById("statusFilter"),
  refresh: document.getElementById("refresh"),
  toggleAll: document.getElementById("toggleAll"),
  clear: document.getElementById("clear"),
  gear: document.getElementById("gear"),
  settings: document.getElementById("settings"),
  elementId: document.getElementById("elementId"),
  saveId: document.getElementById("saveId"),
};

let elementId = DEFAULT_ID;
let entries = []; // last read, unfiltered
let allOpen = true;
let retryTimer = null;

/* ---------- theme ---------- */
try {
  if (chrome.devtools.panels.themeName === "dark") {
    document.body.classList.add("theme-dark");
  }
} catch (e) {}

/* ---------- read from the inspected page ---------- */
function readData(cb) {
  const expr =
    "(function(){var el=document.getElementById(" +
    JSON.stringify(elementId) +
    ");return el?el.textContent:null;})()";
  chrome.devtools.inspectedWindow.eval(expr, function (result, isException) {
    if (isException || result == null) {
      cb({ ok: true, data: null });
      return;
    }
    try {
      cb({ ok: true, data: JSON.parse(result) });
    } catch (e) {
      cb({ ok: false, error: e });
    }
  });
}

// Scan the page for likely SSR-data elements so first-time users don't have to
// know the id. Returns [{id, count}] for every <script type="application/json">
// (with an id) whose content is an array of fetch-like entries.
const DETECT_EXPR =
  "(function(){try{var out=[];var els=document.querySelectorAll('script[type=\"application/json\"]');for(var i=0;i<els.length;i++){var el=els[i];if(!el.id)continue;try{var v=JSON.parse(el.textContent);if(Array.isArray(v)&&v.length&&v[0]&&typeof v[0]==='object'&&('url' in v[0]||'method' in v[0]||'status' in v[0])){out.push({id:el.id,count:v.length});}}catch(e){}}return JSON.stringify(out);}catch(e){return '[]';}})()";

function detect(cb) {
  chrome.devtools.inspectedWindow.eval(DETECT_EXPR, function (result, isException) {
    if (isException || !result) {
      cb([]);
      return;
    }
    try {
      cb(JSON.parse(result));
    } catch (e) {
      cb([]);
    }
  });
}

/* ---------- helpers ---------- */
function statusClass(s) {
  if (!s) return "err";
  if (s < 300) return "ok";
  if (s < 400) return "redir";
  if (s < 500) return "warn";
  return "err";
}
function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
function headerSection(title, h) {
  if (!h || !Object.keys(h).length) return null;
  const det = document.createElement("details");
  det.className = "hdr";
  const sum = document.createElement("summary");
  sum.className = "hdr-sum";
  sum.textContent = title + " (" + Object.keys(h).length + ")";
  det.appendChild(sum);
  const body = document.createElement("div");
  body.className = "hdr-body";
  Object.keys(h).forEach(function (k) {
    const row = document.createElement("div");
    row.className = "hdr-row";
    const key = document.createElement("span");
    key.className = "hdr-key";
    key.textContent = k + ": ";
    const val = document.createElement("span");
    val.className = "hdr-val";
    val.textContent = String(h[k]);
    row.appendChild(key);
    row.appendChild(val);
    body.appendChild(row);
  });
  det.appendChild(body);
  return det;
}
function shortUrl(u) {
  try {
    const p = new URL(u);
    return p.pathname + p.search;
  } catch (e) {
    return u || "";
  }
}
function timeLabel(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString();
  } catch (e) {
    return "";
  }
}
function punct(text) {
  const s = document.createElement("span");
  s.className = "tok-punct";
  s.textContent = text;
  return s;
}

/* ---------- JSON tree ---------- */
function valueNode(value) {
  if (value !== null && typeof value === "object") {
    const isArr = Array.isArray(value);
    const keys = isArr ? value.map((_, i) => i) : Object.keys(value);

    const det = document.createElement("details");
    det.className = "node";
    det.open = allOpen;

    const sum = document.createElement("summary");
    sum.className = "node-sum";
    sum.appendChild(punct(isArr ? "[" : "{"));
    const meta = document.createElement("span");
    meta.className = "node-meta";
    meta.textContent = " " + keys.length + (isArr ? " items " : " keys ");
    sum.appendChild(meta);
    sum.appendChild(punct(isArr ? "]" : "}"));
    det.appendChild(sum);

    const body = document.createElement("div");
    body.className = "node-body";
    keys.forEach(function (k) {
      const kv = document.createElement("div");
      kv.className = "kv";
      if (!isArr) {
        const key = document.createElement("span");
        key.className = "tok-key";
        key.textContent = JSON.stringify(k);
        kv.appendChild(key);
        kv.appendChild(punct(": "));
      }
      kv.appendChild(valueNode(value[k]));
      body.appendChild(kv);
    });
    det.appendChild(body);
    return det;
  }

  const span = document.createElement("span");
  if (value === null) {
    span.className = "tok-null";
    span.textContent = "null";
  } else if (typeof value === "string") {
    span.className = "tok-string";
    span.textContent = JSON.stringify(value);
  } else if (typeof value === "number") {
    span.className = "tok-number";
    span.textContent = String(value);
  } else if (typeof value === "boolean") {
    span.className = "tok-bool";
    span.textContent = String(value);
  } else {
    span.textContent = String(value);
  }
  return span;
}

/* ---------- rows ---------- */
function callRow(entry) {
  const det = document.createElement("details");
  det.className = "call";
  det.open = allOpen;

  const sum = document.createElement("summary");
  sum.className = "call-sum";

  const method = document.createElement("span");
  method.className = "method m-" + (entry.method || "GET").toUpperCase();
  method.textContent = entry.method || "GET";

  const url = document.createElement("span");
  url.className = "url";
  url.textContent = shortUrl(entry.url);
  url.title = entry.url || "";

  const pill = document.createElement("span");
  pill.className = "pill " + statusClass(entry.status);
  pill.textContent = entry.status != null ? entry.status : "—";

  const size = document.createElement("span");
  size.className = "size";
  size.textContent = fmtSize(entry.size);

  const dur = document.createElement("span");
  dur.className = "dur";
  dur.textContent = entry.durationMs != null ? entry.durationMs + "ms" : "";

  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = timeLabel(entry.ts);

  const copy = document.createElement("button");
  copy.className = "copy";
  copy.textContent = "Copy";
  copy.title = "Copy JSON";

  const payload = entry.error != null ? { error: entry.error } : entry.body;
  copy.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const text = JSON.stringify(payload, null, 2);
    try {
      navigator.clipboard.writeText(text);
    } catch (err) {}
    copy.textContent = "Copied";
    setTimeout(function () {
      copy.textContent = "Copy";
    }, 1000);
  });

  sum.appendChild(method);
  sum.appendChild(url);
  sum.appendChild(pill);
  sum.appendChild(size);
  sum.appendChild(dur);
  sum.appendChild(ts);
  sum.appendChild(copy);
  det.appendChild(sum);

  const detail = document.createElement("div");
  detail.className = "detail";
  const reqH = headerSection("Request headers", entry.reqHeaders);
  const resH = headerSection("Response headers", entry.resHeaders);
  if (reqH) detail.appendChild(reqH);
  if (resH) detail.appendChild(resH);

  const tree = document.createElement("div");
  tree.className = "tree";
  tree.appendChild(valueNode(payload));
  detail.appendChild(tree);
  det.appendChild(detail);

  return det;
}

/* ---------- filtering + render ---------- */
function applyFilters(list) {
  const text = els.filter.value.trim().toLowerCase();
  const sf = els.statusFilter.value;
  return list.filter(function (e) {
    if (text && !(e.url || "").toLowerCase().includes(text)) return false;
    const s = e.status;
    if (sf === "2xx") return s >= 200 && s < 300;
    if (sf === "non2xx") return s && !(s >= 200 && s < 300);
    if (sf === "err") return !s || e.error != null;
    return true;
  });
}

function render() {
  els.root.textContent = "";
  const list = applyFilters(entries);

  if (!entries.length) {
    renderEmpty(null);
    return;
  }

  const totalMs = entries.reduce(function (a, e) {
    return a + (e.durationMs || 0);
  }, 0);
  els.summary.textContent =
    list.length +
    (list.length === entries.length ? "" : "/" + entries.length) +
    " calls · " +
    totalMs +
    "ms";

  if (!list.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "No calls match the current filter.";
    els.root.appendChild(div);
    return;
  }
  list.forEach(function (e) {
    els.root.appendChild(callRow(e));
  });
}

function showError() {
  els.root.textContent = "";
  els.summary.textContent = "";
  const div = document.createElement("div");
  div.className = "error";
  div.textContent =
    "Found #" + elementId + " but its contents are not valid JSON.";
  els.root.appendChild(div);
}

// Adopt a detected/clicked element id. persist=true saves it as the default.
function adoptId(id, persist) {
  elementId = id;
  els.elementId.value = id;
  if (persist && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ elementId: id });
  }
  load();
}

// Empty state. With detected candidates, offer them by name so a first-time
// user never has to guess the id; otherwise explain the contract.
function renderEmpty(candidates) {
  els.root.textContent = "";
  els.summary.textContent = "";
  const div = document.createElement("div");
  div.className = "empty";

  if (candidates && candidates.length) {
    const p = document.createElement("p");
    p.innerHTML =
      "Nothing at <code>#" +
      elementId +
      "</code>, but this page exposes SSR data here:";
    div.appendChild(p);

    const list = document.createElement("div");
    list.className = "candidates";
    candidates.forEach(function (c) {
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = "#" + c.id + "  (" + c.count + " calls)";
      b.addEventListener("click", function () {
        adoptId(c.id, true);
      });
      list.appendChild(b);
    });
    div.appendChild(list);

    const hint = document.createElement("p");
    hint.textContent =
      "Click one to use it (saved as default), or set an id via the ⚙ gear.";
    div.appendChild(hint);
  } else {
    div.innerHTML =
      '<p>No SSR data found on this page.</p>' +
      '<p>This panel reads a <code>&lt;script type="application/json" id="…"&gt;</code> array of your app\'s server-side fetches (default id <code>__ssr_data</code>).</p>' +
      "<p>Open a <b>dev build</b> of a server-rendered page that fetches data, then <b>↻ Refresh</b>. If your app uses a different id, it will be offered here automatically — or set it via the ⚙ gear. See the README to add the emitter.</p>";
  }
  els.root.appendChild(div);
}

/* ---------- load ---------- */
function load() {
  readData(function (res) {
    if (!res.ok) {
      entries = [];
      showError();
      return;
    }
    entries = Array.isArray(res.data) ? res.data : [];
    if (!entries.length) {
      // Configured id had nothing — discover what the page actually exposes.
      detect(function (candidates) {
        if (candidates.length === 1 && candidates[0].id !== elementId) {
          // Exactly one match → just use it for this session (gear shows it).
          adoptId(candidates[0].id, false);
          return;
        }
        renderEmpty(candidates);
      });
      return;
    }
    render();
  });
}

/* ---------- color customization ---------- */
const COLOR_VARS = [
  { v: "--m-get", label: "GET" },
  { v: "--m-post", label: "POST" },
  { v: "--m-put", label: "PUT" },
  { v: "--m-patch", label: "PATCH" },
  { v: "--m-delete", label: "DELETE" },
  { v: "--ok", label: "2xx" },
  { v: "--redir", label: "3xx" },
  { v: "--warn", label: "4xx" },
  { v: "--err", label: "5xx" },
];

function applyColors(map) {
  if (!map) return;
  Object.keys(map).forEach(function (k) {
    if (map[k]) document.body.style.setProperty(k, map[k]);
  });
}
function currentColor(varName) {
  const c = getComputedStyle(document.body).getPropertyValue(varName).trim();
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : "#000000";
}
function saveColors() {
  if (!(chrome.storage && chrome.storage.local)) return;
  const map = {};
  COLOR_VARS.forEach(function (item) {
    const inline = document.body.style.getPropertyValue(item.v).trim();
    if (inline) map[item.v] = inline;
  });
  chrome.storage.local.set({ colors: map });
}
function buildColorPickers() {
  const grid = document.getElementById("colorGrid");
  if (!grid) return;
  grid.textContent = "";
  COLOR_VARS.forEach(function (item) {
    const wrap = document.createElement("span");
    wrap.className = "color-item";
    const input = document.createElement("input");
    input.type = "color";
    input.value = currentColor(item.v);
    input.title = item.v;
    input.addEventListener("input", function () {
      document.body.style.setProperty(item.v, input.value);
      saveColors();
    });
    const lab = document.createElement("label");
    lab.textContent = item.label;
    wrap.appendChild(input);
    wrap.appendChild(lab);
    grid.appendChild(wrap);
  });
}
function resetColors() {
  COLOR_VARS.forEach(function (item) {
    document.body.style.removeProperty(item.v);
  });
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove("colors");
  }
  buildColorPickers();
}

/* ---------- settings (configurable element id + colors) ---------- */
function initSettings() {
  if (!(chrome.storage && chrome.storage.local)) {
    els.elementId.value = elementId;
    buildColorPickers();
    autoLoad();
    return;
  }
  chrome.storage.local.get(
    { elementId: DEFAULT_ID, colors: null },
    function (cfg) {
      elementId = cfg.elementId || DEFAULT_ID;
      els.elementId.value = elementId;
      applyColors(cfg.colors);
      buildColorPickers();
      autoLoad();
    },
  );
}
function saveSettings() {
  const next = els.elementId.value.trim() || DEFAULT_ID;
  elementId = next;
  els.settings.hidden = true;
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ elementId: next });
  }
  load();
}

// The data <script> is usually emitted LAST on the page, so it can stream in
// just after the panel's first read. Re-check a few times so the user rarely
// needs to press ↻ manually.
function autoLoad() {
  load();
  let tries = 0;
  clearInterval(retryTimer);
  retryTimer = setInterval(function () {
    if (entries.length || ++tries > 6) {
      clearInterval(retryTimer);
      return;
    }
    load();
  }, 400);
}

/* ---------- wire up ---------- */
els.refresh.addEventListener("click", autoLoad);
els.filter.addEventListener("input", render);
els.statusFilter.addEventListener("change", render);
els.clear.addEventListener("click", function () {
  entries = [];
  render();
});
els.toggleAll.addEventListener("click", function () {
  allOpen = !allOpen;
  render();
});
els.gear.addEventListener("click", function () {
  els.settings.hidden = !els.settings.hidden;
});
els.saveId.addEventListener("click", saveSettings);
els.elementId.addEventListener("keydown", function (e) {
  if (e.key === "Enter") saveSettings();
});
const resetBtn = document.getElementById("resetColors");
if (resetBtn) resetBtn.addEventListener("click", resetColors);

if (chrome.devtools && chrome.devtools.network) {
  chrome.devtools.network.onNavigated.addListener(autoLoad);
}

initSettings();
