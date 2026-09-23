// Shell page rendered inside the canvas panel. Hosts the game in a same-origin
// iframe and draws the overlay: toolbar (reload, viewport presets, auto-reload,
// isolation, FPS sparkline, badges) and a console drawer. Relays agent
// commands arriving over SSE to the game hook and posts results back.

import { escapeHtml } from "./server.mjs";

export const VIEWPORTS = {
    fill: null,
    "1920x1080": [1920, 1080], "1280x720": [1280, 720], "960x540": [960, 540], "800x600": [800, 600],
    iphone: [390, 844], android: [412, 915], ipad: [820, 1180], steamdeck: [1280, 800], "itch-embed": [960, 640],
};

export function renderShell({ title, source, gameSrc, isolation }) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg:#0f1115; --bar:#171a21; --bd:#262a33; --fg:#d7dae0; --mute:#7c8493; --acc:#4fa3ff; --ok:#3fcf8e; --warn:#f2b84b; --err:#ff5c5c; --mono: ui-monospace, SFMono-Regular, Menlo, monospace; }
  * { box-sizing:border-box; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:12px system-ui, -apple-system, sans-serif; overflow:hidden; }
  #app { display:flex; flex-direction:column; height:100%; }
  #bar { display:flex; align-items:center; gap:8px; padding:6px 10px; background:var(--bar); border-bottom:1px solid var(--bd); flex:none; white-space:nowrap; overflow:hidden; }
  #bar .grow { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
  #bar b { font-weight:600; }
  .muted { color:var(--mute); }
  button, select { background:#222633; color:var(--fg); border:1px solid var(--bd); border-radius:6px; padding:3px 8px; font:inherit; cursor:pointer; }
  button:hover, select:hover { border-color:#3a4150; }
  button.primary { background:var(--acc); border-color:var(--acc); color:#04101f; font-weight:600; }
  label.chk { display:inline-flex; align-items:center; gap:4px; color:var(--mute); cursor:pointer; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--err); flex:none; }
  .dot.on { background:var(--ok); }
  .badge { padding:1px 6px; border-radius:4px; border:1px solid var(--bd); color:var(--mute); font-size:11px; }
  .badge.ok { color:var(--ok); border-color:#264a3a; } .badge.bad { color:var(--err); border-color:#5a2a2a; }
  #fps { font:600 13px var(--mono); min-width:58px; text-align:right; }
  #fps.warn { color:var(--warn);} #fps.bad { color:var(--err);}
  #heap { font:11px var(--mono); color:var(--mute); min-width:52px; }
  #spark { width:96px; height:22px; background:#0c0e12; border:1px solid var(--bd); border-radius:4px; }
  #stage { flex:1; min-height:0; position:relative; display:flex; align-items:center; justify-content:center; background:#0a0b0e url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='8' height='8' fill='%230e1014'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%230e1014'/%3E%3C/svg%3E"); overflow:hidden; }
  #wrap { position:relative; }
  #game { border:0; background:#000; display:block; transform-origin:0 0; }
  #vplabel { position:absolute; right:8px; bottom:6px; font:11px var(--mono); color:var(--mute); pointer-events:none; }
  #drawer { flex:none; height:220px; display:flex; flex-direction:column; border-top:1px solid var(--bd); background:#0c0e12; }
  #drawer.hidden { display:none; }
  #grip { height:5px; cursor:row-resize; background:var(--bar); }
  #dbar { display:flex; gap:6px; align-items:center; padding:4px 8px; border-bottom:1px solid var(--bd); }
  #dbar .f { padding:2px 8px; } #dbar .f.on { background:#2a3243; border-color:var(--acc); }
  #search { flex:1; background:#151821; border:1px solid var(--bd); color:var(--fg); border-radius:6px; padding:3px 8px; font:inherit; min-width:60px; }
  #log { flex:1; overflow:auto; font:11.5px/1.45 var(--mono); padding:2px 0; }
  .row { display:flex; gap:8px; padding:1px 10px; border-bottom:1px solid #12151b; white-space:pre-wrap; word-break:break-word; }
  .row .t { color:var(--mute); flex:none; } .row .n { color:var(--mute); flex:none; min-width:26px; text-align:right; }
  .row.warn { color:var(--warn); background:#1a1708; } .row.error { color:#ff8a8a; background:#1c0e0e; } .row.debug { color:var(--mute); } .row.info { color:#9cc7ff; }
  .row.sys { color:var(--acc); justify-content:center; background:#0f1520; }
  .row .stack { display:block; color:#b07a7a; font-size:10.5px; margin-top:2px; }
  #empty { color:var(--mute); text-align:center; padding:20px; }
</style>
</head>
<body>
<div id="app">
  <div id="bar">
    <span class="dot" id="conn" title="Hook connection"></span>
    <span class="grow"><b id="title">${escapeHtml(title)}</b> <span class="muted" id="source">${escapeHtml(source)}</span></span>
    <span id="badges"></span>
    <select id="vp" title="Viewport">
      <option value="fill">Fill panel</option>
      <option value="1920x1080">1920×1080</option><option value="1280x720">1280×720</option>
      <option value="960x540">960×540</option><option value="800x600">800×600</option>
      <option value="itch-embed">itch embed 960×640</option>
      <option value="iphone">iPhone 390×844</option><option value="android">Android 412×915</option>
      <option value="ipad">iPad 820×1180</option><option value="steamdeck">Steam Deck 1280×800</option>
    </select>
    <button id="rot" title="Rotate viewport">⟳</button>
    <label class="chk" title="Reload when files in the watched folder change"><input type="checkbox" id="auto" /> auto</label>
    <label class="chk" title="Send COOP/COEP headers (SharedArrayBuffer / Godot threads)"><input type="checkbox" id="iso" /> isolated</label>
    <canvas id="spark" width="192" height="44"></canvas>
    <span id="fps">-- fps</span><span id="heap"></span>
    <button id="toggle">Console</button>
    <button id="reload" class="primary" title="Reload game (R)">↻ Reload</button>
  </div>
  <div id="stage"><div id="wrap"><iframe id="game" src="${escapeHtml(gameSrc)}" allow="autoplay; fullscreen; gamepad; xr-spatial-tracking; cross-origin-isolated" allowfullscreen></iframe></div><span id="vplabel"></span></div>
  <div id="drawer">
    <div id="grip"></div>
    <div id="dbar">
      <button class="f on" data-f="all">All</button><button class="f" data-f="log">Log</button><button class="f" data-f="warn">Warn</button><button class="f" data-f="error">Errors</button>
      <input id="search" placeholder="filter…" />
      <span class="muted" id="count"></span>
      <button id="clear">Clear</button>
    </div>
    <div id="log"><div id="empty">No console output yet.</div></div>
  </div>
</div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var game = $("game"), wrap = $("wrap"), stage = $("stage"), logEl = $("log");
  var VIEWPORTS = ${JSON.stringify(VIEWPORTS)};
  var state = { viewport: "fill", rotated: false, autoReload: true, isolation: ${JSON.stringify(!!isolation)} };
  var env = null, connected = false, loadedAt = Date.now();
  var logs = [], filter = "all", query = "", counts = { log: 0, info: 0, warn: 0, error: 0, debug: 0 };
  var fpsHist = [], fpsWindow = []; // fpsWindow: last ~60s of samples
  var MAXLOGS = 3000;

  // ---- viewport ----
  function applyViewport() {
    var dims = VIEWPORTS[state.viewport] || null;
    if (state.viewport.indexOf("x") > 0 && !dims) { var p = state.viewport.split("x"); dims = [Number(p[0]), Number(p[1])]; }
    if (!dims) {
      wrap.style.width = "100%"; wrap.style.height = "100%";
      game.style.width = "100%"; game.style.height = "100%"; game.style.transform = "none";
      $("vplabel").textContent = stage.clientWidth + "×" + stage.clientHeight;
      return;
    }
    var w = state.rotated ? dims[1] : dims[0], h = state.rotated ? dims[0] : dims[1];
    var s = Math.min((stage.clientWidth - 16) / w, (stage.clientHeight - 16) / h, 1);
    game.style.width = w + "px"; game.style.height = h + "px"; game.style.transform = "scale(" + s + ")";
    wrap.style.width = Math.round(w * s) + "px"; wrap.style.height = Math.round(h * s) + "px";
    $("vplabel").textContent = w + "×" + h + " @ " + Math.round(s * 100) + "%";
  }
  new ResizeObserver(applyViewport).observe(stage);
  $("vp").onchange = function () { postState({ viewport: this.value }); };
  $("rot").onclick = function () { postState({ rotated: !state.rotated }); };
  $("auto").onchange = function () { postState({ autoReload: this.checked }); };
  $("iso").onchange = function () { postState({ isolation: this.checked }); };
  $("reload").onclick = reload;
  window.addEventListener("keydown", function (e) { if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey && e.target === document.body) reload(); });

  function reload() {
    connected = false; $("conn").className = "dot";
    try { game.contentWindow.location.reload(); } catch (e) { game.src = game.src; }
  }
  function postState(patch) {
    fetch("/__gp/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(function () {});
  }
  function setState(patch) {
    // COOP/COEP apply to this top-level document, so a change needs a full shell reload.
    if (patch.isolation !== undefined && patch.isolation !== state.isolation) { location.reload(); return; }
    Object.assign(state, patch);
    $("vp").value = VIEWPORTS[state.viewport] !== undefined ? state.viewport : "fill";
    if (VIEWPORTS[state.viewport] === undefined && state.viewport.indexOf("x") > 0) { var o = document.createElement("option"); o.value = state.viewport; o.textContent = state.viewport.replace("x", "×"); $("vp").appendChild(o); $("vp").value = state.viewport; }
    $("auto").checked = !!state.autoReload; $("iso").checked = !!state.isolation;
    applyViewport();
  }

  // ---- badges / env ----
  function renderBadges() {
    var b = $("badges"); b.innerHTML = "";
    if (!env) return;
    var add = function (txt, cls, title) { var s = document.createElement("span"); s.className = "badge " + (cls || ""); s.textContent = txt; if (title) s.title = title; b.appendChild(s); };
    add(env.crossOriginIsolated ? "isolated" : "not isolated", env.crossOriginIsolated ? "ok" : "", "crossOriginIsolated=" + env.crossOriginIsolated + " · SharedArrayBuffer=" + env.sharedArrayBuffer);
    if (env.webgl) add(env.webgl.api, "ok", env.webgl.renderer + " · max tex " + env.webgl.maxTextureSize); else add("no WebGL", "bad");
    if (env.webgpu) add("WebGPU", "ok");
    add("dpr " + env.devicePixelRatio, "");
  }

  // ---- fps ----
  function drawSpark() {
    var c = $("spark"), ctx = c.getContext("2d"), W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    if (!fpsHist.length) return;
    var max = Math.max(60, Math.max.apply(null, fpsHist));
    ctx.strokeStyle = "#2a3140"; ctx.beginPath(); var y60 = H - (60 / max) * (H - 4) - 2; ctx.moveTo(0, y60); ctx.lineTo(W, y60); ctx.stroke();
    ctx.beginPath();
    for (var i = 0; i < fpsHist.length; i++) {
      var x = W - (fpsHist.length - 1 - i) * (W / 63), y = H - (fpsHist[i] / max) * (H - 4) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    var last = fpsHist[fpsHist.length - 1];
    ctx.strokeStyle = last >= 55 ? "#3fcf8e" : last >= 30 ? "#f2b84b" : "#ff5c5c"; ctx.lineWidth = 2; ctx.stroke();
  }
  function onFps(m) {
    fpsHist.push(m.fps); if (fpsHist.length > 64) fpsHist.shift();
    fpsWindow.push(m); if (fpsWindow.length > 120) fpsWindow.shift();
    var el = $("fps"); el.textContent = m.fps + " fps"; el.className = m.fps >= 55 ? "" : m.fps >= 30 ? "warn" : "bad";
    el.title = "worst frame " + m.worstMs + " ms" + (m.drawCalls != null ? " · " + m.drawCalls + " draw calls/frame" : "");
    $("heap").textContent = (m.heapMB != null ? m.heapMB + " MB" : "") + (m.drawCalls ? (m.heapMB != null ? " · " : "") + m.drawCalls + " dc" : "");
    drawSpark();
  }
  function stats() {
    var fps = fpsWindow.map(function (m) { return m.fps; });
    var worst = fpsWindow.map(function (m) { return m.worstMs; });
    var avg = fps.length ? Math.round(fps.reduce(function (a, b) { return a + b; }, 0) / fps.length) : null;
    var sorted = worst.slice().sort(function (a, b) { return a - b; });
    var vpDims = VIEWPORTS[state.viewport];
    return {
      connected: connected, secondsSinceLoad: Math.round((Date.now() - loadedAt) / 1000),
      fps: { current: fps.length ? fps[fps.length - 1] : null, avg: avg, min: fps.length ? Math.min.apply(null, fps) : null, max: fps.length ? Math.max.apply(null, fps) : null, samples: fps.length, windowSeconds: Math.round(fps.length * 0.5) },
      frameTimeMs: { worst: sorted.length ? sorted[sorted.length - 1] : null, p95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null },
      heapMB: fpsWindow.length ? fpsWindow[fpsWindow.length - 1].heapMB : null,
      drawCallsPerFrame: fpsWindow.length ? fpsWindow[fpsWindow.length - 1].drawCalls : null,
      console: counts, env: env,
      viewport: { preset: state.viewport, rotated: state.rotated, iframeCss: [game.clientWidth, game.clientHeight], stage: [stage.clientWidth, stage.clientHeight] },
      isolationRequested: state.isolation, autoReload: state.autoReload,
    };
  }

  // ---- console ----
  function fmtTime(t) { var d = new Date(t); return ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2) + "." + ("00" + d.getMilliseconds()).slice(-3); }
  function matches(e) {
    if (e.level === "sys") return true;
    if (filter === "warn" && e.level !== "warn") return false;
    if (filter === "error" && e.level !== "error") return false;
    if (filter === "log" && (e.level === "warn" || e.level === "error")) return false;
    if (query && e.text.toLowerCase().indexOf(query) < 0) return false;
    return true;
  }
  function rowFor(e) {
    var r = document.createElement("div"); r.className = "row " + e.level;
    if (e.level === "sys") { r.textContent = e.text; return r; }
    var t = document.createElement("span"); t.className = "t"; t.textContent = fmtTime(e.t);
    var n = document.createElement("span"); n.className = "n"; n.textContent = e.count > 1 ? "×" + e.count : "";
    var m = document.createElement("span"); m.textContent = e.text;
    if (e.stack) { var s = document.createElement("span"); s.className = "stack"; s.textContent = String(e.stack).split("\\n").slice(1, 5).join("\\n"); m.appendChild(s); }
    r.appendChild(t); r.appendChild(n); r.appendChild(m);
    e.row = r; return r;
  }
  function rerender() {
    logEl.innerHTML = "";
    var shown = 0;
    for (var i = 0; i < logs.length; i++) if (matches(logs[i])) { logEl.appendChild(rowFor(logs[i])); shown++; }
    if (!shown) { var em = document.createElement("div"); em.id = "empty"; em.textContent = logs.length ? "Nothing matches the filter." : "No console output yet."; logEl.appendChild(em); }
    logEl.scrollTop = logEl.scrollHeight;
    updateCount();
  }
  function updateCount() {
    $("count").textContent = logs.length ? counts.error + " err · " + counts.warn + " warn · " + logs.length + " total" : "";
    var total = counts.error + counts.warn;
    $("toggle").textContent = "Console" + (total ? " (" + total + ")" : "");
    $("toggle").style.color = counts.error ? "var(--err)" : counts.warn ? "var(--warn)" : "";
  }
  function addLog(e) {
    var last = logs[logs.length - 1];
    if (last && last.level === e.level && last.text === e.text && e.level !== "sys") {
      last.count = (last.count || 1) + 1; last.t = e.t;
      if (last.row) { last.row.children[1].textContent = "×" + last.count; last.row.children[0].textContent = fmtTime(e.t); }
      return;
    }
    e.count = 1; logs.push(e);
    if (e.level !== "sys") counts[e.level] = (counts[e.level] || 0) + 1;
    if (logs.length > MAXLOGS) { var gone = logs.shift(); if (gone.row) gone.row.remove(); }
    if (matches(e)) {
      var em = $("empty"); if (em) em.remove();
      var stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 30;
      logEl.appendChild(rowFor(e));
      if (stick) logEl.scrollTop = logEl.scrollHeight;
    }
    updateCount();
  }
  function clearLogs() { logs = []; counts = { log: 0, info: 0, warn: 0, error: 0, debug: 0 }; rerender(); }
  Array.prototype.forEach.call(document.querySelectorAll("#dbar .f"), function (b) {
    b.onclick = function () { Array.prototype.forEach.call(document.querySelectorAll("#dbar .f"), function (x) { x.classList.remove("on"); }); b.classList.add("on"); filter = b.dataset.f; rerender(); };
  });
  $("search").oninput = function () { query = this.value.toLowerCase(); rerender(); };
  $("clear").onclick = clearLogs;
  $("toggle").onclick = function () { $("drawer").classList.toggle("hidden"); applyViewport(); };
  (function grip() {
    var g = $("grip"), startY, startH;
    g.onmousedown = function (e) { startY = e.clientY; startH = $("drawer").offsetHeight; document.body.style.userSelect = "none"; window.onmousemove = move; window.onmouseup = up; };
    function move(e) { $("drawer").style.height = Math.max(80, Math.min(window.innerHeight - 120, startH + (startY - e.clientY))) + "px"; applyViewport(); }
    function up() { window.onmousemove = window.onmouseup = null; document.body.style.userSelect = ""; }
  })();

  // ---- messages from the game hook ----
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.__gp !== 1 || e.source !== game.contentWindow) return;
    if (m.type === "hello") {
      env = m.env; connected = true; loadedAt = Date.now(); fpsHist = []; fpsWindow = [];
      $("conn").className = "dot on"; renderBadges(); drawSpark();
      addLog({ level: "sys", text: "— page loaded " + new Date().toLocaleTimeString() + (env.crossOriginIsolated ? " · isolated" : "") + " —", t: Date.now() });
    } else if (m.type === "console") addLog({ level: m.level, text: m.text, stack: m.stack, t: m.t });
    else if (m.type === "fps") onFps(m);
    else if (m.type === "result") sendResult(m.id, m.ok, m.value, m.error);
  });
  game.addEventListener("load", function () {
    setTimeout(function () { if (!connected) addLog({ level: "sys", text: "— page loaded but the preview hook did not run (non-HTML entry, compressed HTML, or CSP?) —", t: Date.now() }); }, 1500);
  });

  // ---- command channel (agent actions) ----
  function sendResult(id, ok, value, error) {
    fetch("/__gp/api/result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id, ok: ok, value: value, error: error }) }).catch(function () {});
  }
  function handleCmd(cmd) {
    if (cmd.target === "game") {
      if (!connected) return sendResult(cmd.id, false, null, "Game page is not connected (hook not loaded yet or page failed to load).");
      game.contentWindow.postMessage(Object.assign({ __gp: 1, type: "cmd" }, cmd), "*");
      return;
    }
    try {
      switch (cmd.kind) {
        case "get_logs": {
          var lvl = cmd.level || "all", limit = cmd.limit || 200, q = (cmd.query || "").toLowerCase();
          var src = logs.filter(function (e) {
            if (e.level === "sys") return lvl === "all" && !q;
            if (lvl === "error" && e.level !== "error") return false;
            if (lvl === "warn" && e.level !== "warn" && e.level !== "error") return false;
            if (q && e.text.toLowerCase().indexOf(q) < 0) return false;
            return true;
          });
          var out = src.slice(-limit).map(function (e) { return { t: new Date(e.t).toISOString().slice(11, 23), level: e.level, text: e.text, count: e.count > 1 ? e.count : undefined, stack: e.stack ? String(e.stack).split("\\n").slice(0, 6).join("\\n") : undefined }; });
          var res = { entries: out, returned: out.length, matched: src.length, totals: counts };
          if (cmd.clear) clearLogs();
          return sendResult(cmd.id, true, res);
        }
        case "clear_logs": clearLogs(); return sendResult(cmd.id, true, { cleared: true });
        case "get_stats": return sendResult(cmd.id, true, stats());
        case "reload": reload(); return sendResult(cmd.id, true, { reloaded: true });
        default: return sendResult(cmd.id, false, null, "Unknown shell command " + cmd.kind);
      }
    } catch (err) { sendResult(cmd.id, false, null, String(err && err.message || err)); }
  }

  // ---- SSE from the extension ----
  var es = new EventSource("/__gp/events");
  es.addEventListener("state", function (e) { setState(JSON.parse(e.data)); });
  es.addEventListener("cmd", function (e) { handleCmd(JSON.parse(e.data)); });
  es.addEventListener("reload", function (e) {
    var d = JSON.parse(e.data);
    addLog({ level: "sys", text: "— reloading: " + (d.reason || "requested") + " —", t: Date.now() });
    reload();
  });
  es.addEventListener("hint", function (e) { addLog({ level: "sys", text: JSON.parse(e.data).text, t: Date.now() }); });
  applyViewport();
})();
</script>
</body>
</html>`;
}
