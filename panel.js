// Network-tab–style viewer for the server-side fetch log an SSR app embeds in
// the page (a <script type="application/json" id="…"> array of
// { method, url, status, ok, durationMs, ts?, size?, reqHeaders?, resHeaders?, body?, error? }).
// Uses chrome.devtools.inspectedWindow.eval, so it needs no host permissions.

const DEFAULT_ID = "__ssr_data";

const els = {
  refresh: document.getElementById("refresh"),
  filter: document.getElementById("filter"),
  statusFilter: document.getElementById("statusFilter"),
  clear: document.getElementById("clear"),
  gear: document.getElementById("gear"),
  summary: document.getElementById("summary"),
  settings: document.getElementById("settings"),
  elementId: document.getElementById("elementId"),
  saveId: document.getElementById("saveId"),
  resetColors: document.getElementById("resetColors"),
  net: document.getElementById("net"),
  head: document.getElementById("head"),
  rows: document.getElementById("rows"),
  empty: document.getElementById("empty"),
  divider: document.getElementById("divider"),
  detail: document.getElementById("detail"),
  detailHead: document.getElementById("detailHead"),
  detailBody: document.getElementById("detailBody"),
  detailClose: document.getElementById("detailClose"),
};

let elementId = DEFAULT_ID;
let entries = []; // last read, unfiltered
let filtered = [];
let selectedEntry = null;
let sortKey = null; // null = insertion order
let sortDir = 1; // 1 asc, -1 desc
let detailTab = "headers";
let rawResponse = false;
let retryTimer = null;

/* ---------- theme ---------- */
try {
  if (chrome.devtools.panels.themeName === "dark") {
    document.body.classList.add("theme-dark");
  }
} catch (e) {}

/* ---------- read inspected page ---------- */
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

const DETECT_EXPR =
  "(function(){try{var out=[];var els=document.querySelectorAll('script[type=\"application/json\"]');for(var i=0;i<els.length;i++){var el=els[i];if(!el.id)continue;try{var v=JSON.parse(el.textContent);if(Array.isArray(v)&&v.length&&v[0]&&typeof v[0]==='object'&&('url' in v[0]||'method' in v[0]||'status' in v[0])){out.push({id:el.id,count:v.length});}}catch(e){}}return JSON.stringify(out);}catch(e){return '[]';}})()";

function detect(cb) {
  chrome.devtools.inspectedWindow.eval(DETECT_EXPR, function (result, isException) {
    if (isException || !result) return cb([]);
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
function shortUrl(u) {
  try {
    const p = new URL(u);
    return p.pathname + p.search;
  } catch (e) {
    return u || "";
  }
}
function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
function fmtTime(ms) {
  if (ms == null) return "";
  if (ms < 1000) return ms + " ms";
  return (ms / 1000).toFixed(2) + " s";
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
    det.open = true;
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
      const line = document.createElement("div");
      line.className = "kvline";
      if (!isArr) {
        const key = document.createElement("span");
        key.className = "tok-key";
        key.textContent = JSON.stringify(k);
        line.appendChild(key);
        line.appendChild(punct(": "));
      }
      line.appendChild(valueNode(value[k]));
      body.appendChild(line);
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

/* ---------- detail pane blocks ---------- */
function kvBlock(title, pairs) {
  const block = document.createElement("div");
  block.className = "block";
  const h = document.createElement("div");
  h.className = "block-title";
  h.textContent = title;
  block.appendChild(h);
  pairs.forEach(function (p) {
    if (p[1] == null || p[1] === "") return;
    const row = document.createElement("div");
    row.className = "kv";
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = p[0] + ":";
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = String(p[1]);
    row.appendChild(k);
    row.appendChild(v);
    block.appendChild(row);
  });
  return block;
}
function headerBlock(title, h) {
  if (!h || !Object.keys(h).length) return null;
  const pairs = Object.keys(h).map(function (k) {
    return [k, h[k]];
  });
  return kvBlock(title, pairs);
}

function renderDetail() {
  if (!selectedEntry) {
    els.detail.hidden = true;
    els.divider.hidden = true;
    document.body.classList.remove("detail-open");
    return;
  }
  els.detail.hidden = false;
  els.divider.hidden = false;
  const tabs = els.detail.querySelectorAll(".dtab");
  Array.prototype.forEach.call(tabs, function (b) {
    b.classList.toggle("active", b.dataset.tab === detailTab);
  });

  const e = selectedEntry;

  // Persistent summary, shown on every tab.
  els.detailHead.textContent = "";
  const dhUrl = document.createElement("div");
  dhUrl.className = "dh-url";
  dhUrl.textContent = e.url || "";
  dhUrl.title = e.url || "";
  els.detailHead.appendChild(dhUrl);
  const dhMeta = document.createElement("div");
  dhMeta.className = "dh-meta";
  const dhM = document.createElement("span");
  dhM.className = "dh-method m-" + (e.method || "GET").toUpperCase();
  dhM.textContent = e.method || "GET";
  const dhS = document.createElement("span");
  dhS.className = "dh-status s-" + statusClass(e.status);
  dhS.textContent = e.status != null ? e.status : "—";
  const dhZ = document.createElement("span");
  dhZ.className = "dh-dim";
  dhZ.textContent = fmtSize(e.size);
  const dhT = document.createElement("span");
  dhT.className = "dh-dim";
  dhT.textContent = fmtTime(e.durationMs);
  dhMeta.appendChild(dhM);
  dhMeta.appendChild(dhS);
  dhMeta.appendChild(dhZ);
  dhMeta.appendChild(dhT);
  if (e.ts) {
    const dhW = document.createElement("span");
    dhW.className = "dh-dim";
    dhW.textContent = timeLabel(e.ts);
    dhMeta.appendChild(dhW);
  }
  els.detailHead.appendChild(dhMeta);
  if (e.error != null) {
    const dhErr = document.createElement("div");
    dhErr.className = "dh-err";
    dhErr.textContent = "Error: " + e.error;
    els.detailHead.appendChild(dhErr);
  }

  const body = els.detailBody;
  body.textContent = "";

  if (detailTab === "headers") {
    const rq = headerBlock("Request Headers", e.reqHeaders);
    const rs = headerBlock("Response Headers", e.resHeaders);
    if (rq) body.appendChild(rq);
    if (rs) body.appendChild(rs);
    if (!rq && !rs) {
      const none = document.createElement("div");
      none.className = "hint";
      none.textContent = "No headers captured for this call.";
      body.appendChild(none);
    }
  } else if (detailTab === "response") {
    const payload = e.error != null ? { error: e.error } : e.body;
    const bar = document.createElement("div");
    bar.className = "resp-bar";
    const copy = document.createElement("button");
    copy.className = "btn";
    copy.textContent = "Copy JSON";
    copy.addEventListener("click", function () {
      try {
        navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      } catch (err) {}
      copy.textContent = "Copied";
      setTimeout(function () {
        copy.textContent = "Copy JSON";
      }, 1000);
    });
    const rawBtn = document.createElement("button");
    rawBtn.className = "btn";
    rawBtn.textContent = rawResponse ? "Tree" : "Raw";
    rawBtn.addEventListener("click", function () {
      rawResponse = !rawResponse;
      renderDetail();
    });
    bar.appendChild(copy);
    bar.appendChild(rawBtn);
    body.appendChild(bar);

    if (payload === undefined) {
      const none = document.createElement("div");
      none.className = "hint";
      none.textContent = "No response body captured.";
      body.appendChild(none);
    } else if (rawResponse) {
      const pre = document.createElement("pre");
      pre.className = "raw";
      pre.textContent = JSON.stringify(payload, null, 2);
      body.appendChild(pre);
    } else {
      const tree = document.createElement("div");
      tree.className = "tree";
      tree.appendChild(valueNode(payload));
      body.appendChild(tree);
    }
  } else {
    // timing
    const block = kvBlock("Timing", [
      ["Started", timeLabel(e.ts)],
      ["Duration", fmtTime(e.durationMs)],
    ]);
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.width = Math.max(4, Math.min(100, (e.durationMs || 0) / 30)) + "px";
    block.appendChild(bar);
    body.appendChild(block);
  }
}

function selectRow(entry, tr) {
  selectedEntry = entry;
  Array.prototype.forEach.call(els.rows.querySelectorAll("tr.selected"), function (x) {
    x.classList.remove("selected");
  });
  if (tr) tr.classList.add("selected");
  document.body.classList.add("detail-open");
  renderDetail();
}

/* ---------- table ---------- */
function applyFilters(list) {
  const text = els.filter.value.trim().toLowerCase();
  const sf = els.statusFilter.value;
  return list.filter(function (e) {
    if (text && !(e.url || "").toLowerCase().includes(text)) return false;
    const s = e.status;
    if (sf === "2xx") return s >= 200 && s < 300;
    if (sf === "3xx") return s >= 300 && s < 400;
    if (sf === "4xx") return s >= 400 && s < 500;
    if (sf === "5xx") return s >= 500;
    if (sf === "err") return !s || e.error != null;
    return true;
  });
}
function sortList(list) {
  if (!sortKey) return list;
  return list.slice().sort(function (a, b) {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (sortKey === "url" || sortKey === "method") {
      av = (av || "").toString().toLowerCase();
      bv = (bv || "").toString().toLowerCase();
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    }
    return ((Number(av) || 0) - (Number(bv) || 0)) * sortDir;
  });
}
function updateSortIndicators() {
  Array.prototype.forEach.call(els.head.querySelectorAll("th"), function (th) {
    const base = th.dataset.label || th.textContent;
    th.dataset.label = base;
    th.textContent =
      base + (th.dataset.key === sortKey ? (sortDir > 0 ? " ▲" : " ▼") : "");
  });
}
function renderRows(list) {
  els.rows.textContent = "";
  const maxDur = list.reduce(function (m, e) {
    return Math.max(m, e.durationMs || 0);
  }, 0) || 1;

  list.forEach(function (entry) {
    const tr = document.createElement("tr");
    if (entry === selectedEntry) tr.classList.add("selected");

    const name = document.createElement("td");
    name.className = "cell-name";
    name.textContent = shortUrl(entry.url);
    name.title = entry.url || "";

    const method = document.createElement("td");
    method.className = "cell-method m-" + (entry.method || "GET").toUpperCase();
    method.textContent = entry.method || "GET";

    const status = document.createElement("td");
    status.className = "cell-status s-" + statusClass(entry.status);
    status.textContent = entry.status != null ? entry.status : "—";

    const size = document.createElement("td");
    size.className = "cell-size";
    size.textContent = fmtSize(entry.size);

    const time = document.createElement("td");
    time.className = "cell-time";
    const wrap = document.createElement("div");
    wrap.className = "time-wrap";
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = fmtTime(entry.durationMs);
    const wf = document.createElement("span");
    wf.className = "wf";
    wf.style.width =
      Math.max(2, Math.round(((entry.durationMs || 0) / maxDur) * 90)) + "px";
    wrap.appendChild(t);
    wrap.appendChild(wf);
    time.appendChild(wrap);

    tr.appendChild(name);
    tr.appendChild(method);
    tr.appendChild(status);
    tr.appendChild(size);
    tr.appendChild(time);
    tr.addEventListener("click", function () {
      selectRow(entry, tr);
    });
    els.rows.appendChild(tr);
  });
}
function updateSummary() {
  const totalMs = entries.reduce(function (a, e) {
    return a + (e.durationMs || 0);
  }, 0);
  const totalSize = entries.reduce(function (a, e) {
    return a + (e.size || 0);
  }, 0);
  els.summary.textContent =
    filtered.length +
    (filtered.length === entries.length ? "" : "/" + entries.length) +
    " calls · " +
    fmtSize(totalSize) +
    " · " +
    fmtTime(totalMs);
}

function render() {
  if (!entries.length) {
    renderEmpty(null);
    return;
  }
  els.net.hidden = false;
  els.empty.hidden = true;

  filtered = sortList(applyFilters(entries));
  updateSummary();
  renderRows(filtered);
  updateSortIndicators();

  if (selectedEntry && entries.indexOf(selectedEntry) === -1) {
    selectedEntry = null;
  }
  renderDetail();
}

function renderEmpty(candidates) {
  els.net.hidden = true;
  els.empty.hidden = false;
  els.detail.hidden = true;
  els.divider.hidden = true;
  els.summary.textContent = "";
  els.empty.textContent = "";

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
      "<p>No SSR data found on this page.</p>" +
      '<p>This panel reads a <code>&lt;script type="application/json" id="…"&gt;</code> array of your app\'s server-side fetches (default id <code>__ssr_data</code>).</p>' +
      "<p>Open a <b>dev build</b> of a server-rendered page that fetches data, then <b>↻ Refresh</b>. A different id is offered here automatically — or set it via the ⚙ gear.</p>";
  }
  els.empty.appendChild(div);
}

function showError() {
  els.net.hidden = true;
  els.empty.hidden = false;
  els.detail.hidden = true;
  els.divider.hidden = true;
  els.summary.textContent = "";
  els.empty.textContent = "";
  const div = document.createElement("div");
  div.className = "error";
  div.textContent =
    "Found #" + elementId + " but its contents are not valid JSON.";
  els.empty.appendChild(div);
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
      detect(function (candidates) {
        if (candidates.length === 1 && candidates[0].id !== elementId) {
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

function adoptId(id, persist) {
  elementId = id;
  els.elementId.value = id;
  if (persist && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ elementId: id });
  }
  load();
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
      render();
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
  render();
}

/* ---------- settings ---------- */
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
  elementId = els.elementId.value.trim() || DEFAULT_ID;
  els.settings.hidden = true;
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ elementId: elementId });
  }
  load();
}

/* ---------- divider drag ---------- */
els.divider.addEventListener("mousedown", function (e) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = els.detail.offsetWidth;
  function move(ev) {
    const w = Math.max(220, Math.min(window.innerWidth - 200, startW + (startX - ev.clientX)));
    els.detail.style.width = w + "px";
  }
  function up() {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  }
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

/* ---------- wire up ---------- */
els.refresh.addEventListener("click", autoLoad);
els.filter.addEventListener("input", render);
els.statusFilter.addEventListener("change", render);
els.clear.addEventListener("click", function () {
  entries = [];
  selectedEntry = null;
  render();
});
els.gear.addEventListener("click", function () {
  els.settings.hidden = !els.settings.hidden;
});
els.saveId.addEventListener("click", saveSettings);
els.elementId.addEventListener("keydown", function (e) {
  if (e.key === "Enter") saveSettings();
});
if (els.resetColors) els.resetColors.addEventListener("click", resetColors);

Array.prototype.forEach.call(els.head.querySelectorAll("th"), function (th) {
  th.addEventListener("click", function () {
    const key = th.dataset.key;
    if (sortKey === key) sortDir = -sortDir;
    else {
      sortKey = key;
      sortDir = 1;
    }
    render();
  });
});

els.detail.querySelectorAll(".dtab").forEach(function (b) {
  b.addEventListener("click", function () {
    detailTab = b.dataset.tab;
    renderDetail();
  });
});
els.detailClose.addEventListener("click", function () {
  selectedEntry = null;
  Array.prototype.forEach.call(els.rows.querySelectorAll("tr.selected"), function (x) {
    x.classList.remove("selected");
  });
  renderDetail();
});

if (chrome.devtools && chrome.devtools.network) {
  chrome.devtools.network.onNavigated.addListener(autoLoad);
}

initSettings();
