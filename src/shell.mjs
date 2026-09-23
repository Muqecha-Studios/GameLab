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
  #dbar .tab { padding:2px 10px; font-weight:600; } #dbar .tab.on { background:#2a3243; border-color:var(--acc); }
  #dbar .sep { width:1px; height:16px; background:var(--bd); }
  #perf { flex:1; overflow:auto; display:none; font:11.5px/1.5 var(--mono); padding:6px 10px 10px; }
  #drawer.perf #perf { display:block; } #drawer.perf #log, #drawer.perf .con { display:none; }
  .sec { display:grid; grid-template-columns:64px 1fr; gap:2px 10px; padding:4px 0; border-bottom:1px solid #12151b; }
  .sec > b { color:var(--mute); font-weight:600; }
  .kv { display:inline-block; margin-right:14px; } .kv i { color:var(--mute); font-style:normal; margin-right:4px; }
  .kv.warn { color:var(--warn);} .kv.bad { color:var(--err);}
  #findings li { margin:1px 0; } #findings li.warn { color:var(--warn);} #findings li.bad { color:#ff8a8a;} #findings li.info { color:#9cc7ff;}
  #findings ul { margin:0; padding-left:16px; }
  table.prof { border-collapse:collapse; width:100%; margin-top:4px; } table.prof td, table.prof th { text-align:left; padding:1px 8px 1px 0; white-space:nowrap; } table.prof th { color:var(--mute); font-weight:600; }
  table.prof td.num, table.prof th.num { text-align:right; } table.prof td.fn { width:100%; max-width:420px; overflow:hidden; text-overflow:ellipsis; } table.prof td.src { color:var(--mute); max-width:280px; overflow:hidden; text-overflow:ellipsis; }
  .bar { display:inline-block; height:8px; background:var(--acc); vertical-align:middle; margin-right:4px; border-radius:2px; }
  #perfhint { color:var(--mute); }
  #drawer:not(.perf) #resetm, #drawer:not(.perf) #profms, #drawer:not(.perf) #prof, #drawer:not(.perf) #perfhint { display:none; }
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
    <button id="perfbtn" title="Frame times, hitches, WebGL counters, load timeline, findings, CPU profile">Perf</button>
    <button id="reload" class="primary" title="Reload game (R)">↻ Reload</button>
  </div>
  <div id="stage"><div id="wrap"><iframe id="game" src="${escapeHtml(gameSrc)}" allow="autoplay; fullscreen; gamepad; xr-spatial-tracking; cross-origin-isolated" allowfullscreen></iframe></div><span id="vplabel"></span></div>
  <div id="drawer">
    <div id="grip"></div>
    <div id="dbar">
      <button class="tab on" data-tab="console">Console</button><button class="tab" data-tab="perf">Perf</button><span class="sep"></span>
      <button class="f con on" data-f="all">All</button><button class="f con" data-f="log">Log</button><button class="f con" data-f="warn">Warn</button><button class="f con" data-f="error">Errors</button>
      <input id="search" class="con" placeholder="filter…" />
      <span class="muted con" id="count"></span>
      <button id="clear" class="con">Clear</button>
      <span id="perfhint" class="grow"></span>
      <button id="resetm" title="Reset hitch log and frame-time samples">Reset</button>
      <select id="profms" title="Profile duration"><option value="3000">3 s</option><option value="5000" selected>5 s</option><option value="10000">10 s</option><option value="20000">20 s</option></select>
      <button id="prof" class="primary" title="Sample the main thread (JS Self-Profiling API) and list hot functions">● Profile</button>
    </div>
    <div id="log"><div id="empty">No console output yet.</div></div>
    <div id="perf"><div id="perfbody" class="muted" style="padding:12px 0">Waiting for the game hook…</div></div>
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
  $("toggle").onclick = function () { var d = $("drawer"); if (d.classList.contains("hidden") || perf.tab !== "console") { d.classList.remove("hidden"); setTab("console"); } else d.classList.add("hidden"); applyViewport(); };
  (function grip() {
    var g = $("grip"), startY, startH;
    g.onmousedown = function (e) { startY = e.clientY; startH = $("drawer").offsetHeight; document.body.style.userSelect = "none"; window.onmousemove = move; window.onmouseup = up; };
    function move(e) { $("drawer").style.height = Math.max(80, Math.min(window.innerHeight - 120, startH + (startY - e.clientY))) + "px"; applyViewport(); }
    function up() { window.onmousemove = window.onmouseup = null; document.body.style.userSelect = ""; }
  })();


  // ---- perf tab ----
  var uiPending = {}, uiSeq = 0;
  function askGame(kind, extra, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!connected) return reject(new Error("game not connected"));
      var id = "ui:" + (++uiSeq);
      var timer = setTimeout(function () { delete uiPending[id]; reject(new Error("timeout")); }, timeoutMs || 5000);
      uiPending[id] = { resolve: resolve, reject: reject, timer: timer };
      game.contentWindow.postMessage(Object.assign({ __gp: 1, type: "cmd", id: id, kind: kind }, extra || {}), "*");
    });
  }
  var perf = { tab: "console", timer: null, prevM: null, prevT: 0, rates: {}, heapHist: [], timeline: null, lastM: null, profile: null, profiling: false, shaderBase: null, shaderBaseAt: 0 };
  function perfReset() { perf.prevM = null; perf.rates = {}; perf.heapHist = []; perf.timeline = null; perf.lastM = null; perf.profile = null; perf.shaderBase = null; }
  function setTab(t) {
    perf.tab = t;
    Array.prototype.forEach.call(document.querySelectorAll("#dbar .tab"), function (b) { b.classList.toggle("on", b.dataset.tab === t); });
    $("drawer").classList.toggle("perf", t === "perf");
    if (t === "perf") { if (parseInt($("drawer").style.height || "220", 10) < 340) $("drawer").style.height = Math.round(Math.min(window.innerHeight * 0.48, 460)) + "px"; perfTick(); }
  }
  Array.prototype.forEach.call(document.querySelectorAll("#dbar .tab"), function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
  $("perfbtn").onclick = function () { var d = $("drawer"); if (d.classList.contains("hidden") || perf.tab !== "perf") { d.classList.remove("hidden"); setTab("perf"); } else { d.classList.add("hidden"); } applyViewport(); };
  $("resetm").onclick = function () { askGame("reset_hitches").then(function () { perf.heapHist = []; perfTick(); }).catch(function () {}); };
  $("prof").onclick = runProfile;
  setInterval(function () { if (perf.tab === "perf" && !$("drawer").classList.contains("hidden") && !document.hidden) perfTick(); }, 1000);

  function perfTick() {
    if (!connected) { $("perfbody").innerHTML = '<div class="muted" style="padding:12px 0">Waiting for the game hook…</div>'; return; }
    askGame("metrics").then(function (m) {
      var now = Date.now();
      if (perf.prevM && now > perf.prevT) {
        var dt = (now - perf.prevT) / 1000, a = m.webgl, b = perf.prevM.webgl;
        perf.rates = { tex: (a.textureUploads - b.textureUploads) / dt, buf: (a.bufferUploads - b.bufferUploads) / dt, shaders: (a.shaderCompiles - b.shaderCompiles) / dt, draws: (a.drawCallsTotal - b.drawCallsTotal) / dt };
      }
      perf.prevM = m; perf.prevT = now; perf.lastM = m;
      if (perf.shaderBase === null && m.uptimeMs > 10000) { perf.shaderBase = m.webgl.shaderCompiles; perf.shaderBaseAt = m.uptimeMs; }
      if (m.memory && m.memory.heapMB != null) { perf.heapHist.push({ t: now, mb: m.memory.heapMB }); while (perf.heapHist.length && now - perf.heapHist[0].t > 60000) perf.heapHist.shift(); }
      if (!perf.timeline || (perf.timeline.firstWebglDrawMs === null && m.uptimeMs < 60000)) askGame("load_timeline").then(function (t) { perf.timeline = t; renderPerf(); }).catch(function () {});
      renderPerf();
    }).catch(function (e) { $("perfhint").textContent = "metrics: " + e.message; });
  }
  function kv(label, val, cls, title) { return '<span class="kv ' + (cls || "") + '"' + (title ? ' title="' + esc(title) + '"' : "") + '><i>' + esc(label) + '</i>' + esc(String(val)) + '</span>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function secs(ms) { return ms == null ? "–" : ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms"; }
  function mb(kb) { return kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : Math.round(kb) + " KB"; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function heapDelta() {
    if (perf.heapHist.length < 5) return null;
    var first = perf.heapHist[0], last = perf.heapHist[perf.heapHist.length - 1], span = (last.t - first.t) / 1000;
    if (span < 20) return null;
    return { perMin: r1((last.mb - first.mb) * 60 / span), span: Math.round(span), from: first.mb, to: last.mb };
  }
  function findings(m) {
    var out = [], f = m.frame, t = perf.timeline, r = perf.rates, w = m.webgl, gameplay = m.uptimeMs > 10000;
    var add = function (cls, text) { out.push({ cls: cls, text: text }); };
    if (w.contextLostCount) add("bad", "WebGL context was lost " + w.contextLostCount + "× — check the engine recovers (screen not black, no 'does not belong to this context' spam).");
    if (f.samples > 60) {
      if (f.p95Ms > 33.4) add("bad", "Not holding 30 fps: p95 frame time " + f.p95Ms + " ms (p99 " + f.p99Ms + " ms). Profile to find the hot path.");
      else if (f.p95Ms > 17.5) add("warn", "Not holding 60 fps: p95 frame time " + f.p95Ms + " ms (p99 " + f.p99Ms + " ms).");
      else add("ok", "Frame time steady: p95 " + f.p95Ms + " ms, p99 " + f.p99Ms + " ms.");
    }
    if (m.hitches.count) {
      var rec = m.hitches.recent, spiky = rec.filter(function (h) { return h.draws > 2 * Math.max(1, f.lastDrawCalls); }).length;
      var late = rec.filter(function (h) { return (t && t.firstWebglDrawMs != null) ? h.at > t.firstWebglDrawMs + 3000 : h.at > 8000; }).length;
      if (late) add("warn", late + " hitch" + (late > 1 ? "es" : "") + " > " + m.hitches.thresholdMs + " ms during gameplay (worst " + Math.max.apply(null, rec.map(function (h) { return h.dt; })) + " ms)" + (spiky ? "; " + spiky + " coincide with a draw-call spike (scene/level load or spawn burst?)" : "; not draw-related — likely GC, asset decode, shader compile or a JS/wasm spike. Profile during a hitch.") );
      else add("info", m.hitches.count + " hitch" + (m.hitches.count > 1 ? "es" : "") + " at startup only (wasm compile / first draw) — fine.");
    }
    if (gameplay && perf.shaderBase !== null && w.shaderCompiles - perf.shaderBase > 0) add("warn", (w.shaderCompiles - perf.shaderBase) + " shader compile" + (w.shaderCompiles - perf.shaderBase > 1 ? "s" : "") + " after the first 10 s — compiling on first use causes hitches; warm up materials/shaders on a loading screen.");
    if (gameplay && r.tex > 2) add("warn", "Texture uploads every frame (" + r1(r.tex) + "/s) — video/canvas→texture or dynamic atlases; cache or throttle if possible.");
    if (f.lastDrawCalls > 800) add("warn", f.lastDrawCalls + " draw calls/frame — batch sprites/meshes or use instancing.");
    var hd = heapDelta();
    if (hd && hd.perMin > 8) add("warn", "JS heap growing " + (hd.perMin > 0 ? "+" : "") + hd.perMin + " MB/min (" + hd.from + " → " + hd.to + " MB over " + hd.span + " s) — possible leak; take two heap snapshots in DevTools.");
    if (m.memory && m.memory.heapLimitMB && m.memory.heapMB > 0.7 * m.memory.heapLimitMB) add("bad", "JS heap at " + m.memory.heapMB + " / " + m.memory.heapLimitMB + " MB — close to the limit, tabs will be killed on mobile.");
    if (t) {
      if (t.firstWebglDrawMs != null && t.firstWebglDrawMs > 4000) add("warn", "First WebGL draw at " + secs(t.firstWebglDrawMs) + " — slow boot. Largest: " + (t.resources.largest[0] ? t.resources.largest[0].name.split("/").pop() + " " + mb(t.resources.largest[0].decodedKB) : "?"));
      var wasm = t.resources.largest.filter(function (x) { return /\\.wasm(\\?|$)/.test(x.name); })[0];
      if (wasm && wasm.transferKB && wasm.decodedKB && wasm.transferKB > 0.85 * wasm.decodedKB && wasm.decodedKB > 2048) add("info", wasm.name.split("/").pop() + " is served uncompressed (" + mb(wasm.transferKB) + " on the wire). Brotli/gzip cuts it ~4×; here that's a local server, but check your production host.");
      if (wasm && wasm.decodedKB > 25000) add("info", "wasm is " + mb(wasm.decodedKB) + " — for Godot, strip unused modules in a custom export template; for Unity, enable code stripping + Brotli.");
      if (t.resources.totalDecodedKB > 60000) add("info", "Total assets " + mb(t.resources.totalDecodedKB) + " over " + t.resources.count + " requests.");
    }
    if (env && !env.crossOriginIsolated && env.hardwareConcurrency > 1) add("info", "Not cross-origin isolated: no SharedArrayBuffer/threads (needed for Godot thread-enabled exports & Unity multithreading). Toggle 'isolated' to test.");
    if (perf.profile && perf.profile.supported) {
      var hot = perf.profile.hotFunctions[0];
      if (hot && hot.selfPct >= 25) add("warn", "Hot function: " + hot.name + " — " + hot.selfPct + "% of busy time (" + (hot.url ? hot.url.split("/").pop() + ":" + hot.line : "native") + ").");
      if (perf.profile.busyPct > 85) add("warn", "Main thread " + perf.profile.busyPct + "% busy during the profile — no headroom; low-end devices will drop frames.");
      if (perf.profile.gcMs > perf.profile.durationMs * 0.05) add("warn", "GC took " + perf.profile.gcMs + " ms (" + Math.round(perf.profile.gcMs / perf.profile.durationMs * 100) + "%) — reduce per-frame allocations (closures, arrays, vectors).");
    }
    return out;
  }
  function renderPerf() {
    var m = perf.lastM; if (!m) return;
    var f = m.frame, w = m.webgl, r = perf.rates, t = perf.timeline, h = '';
    var fcls = function (v) { return v > 33.4 ? "bad" : v > 17.5 ? "warn" : ""; };
    h += '<div class="sec"><b>Frame</b><div>' + kv("p50", f.p50Ms + " ms", fcls(f.p50Ms)) + kv("p95", f.p95Ms + " ms", fcls(f.p95Ms)) + kv("p99", f.p99Ms + " ms", fcls(f.p99Ms)) + kv("max", f.maxMs + " ms", fcls(f.maxMs)) + kv("samples", f.samples) +
      kv("hitches", m.hitches.count + " >" + m.hitches.thresholdMs + "ms", m.hitches.count ? "warn" : "") + kv("visibility", m.visibility) + kv("uptime", secs(m.uptimeMs)) + '</div></div>';
    if (m.hitches.recent.length) {
      h += '<div class="sec"><b>Hitches</b><div>' + m.hitches.recent.slice(-12).map(function (x) { return kv("@" + secs(x.at), x.dt + " ms" + (x.draws != null ? " · " + x.draws + " dc" : ""), x.dt > 200 ? "bad" : "warn"); }).join("") + '</div></div>';
    }
    h += '<div class="sec"><b>WebGL</b><div>' + kv("draws/frame", f.lastDrawCalls) + kv("draws/s", Math.round(r.draws || 0)) + kv("instances", w.instancesTotal) + kv("tex uploads", w.textureUploads + (r.tex ? " (" + r1(r.tex) + "/s)" : ""), r.tex > 2 ? "warn" : "") +
      kv("buffer uploads", w.bufferUploads + (r.buf ? " (" + Math.round(r.buf) + "/s)" : "")) + kv("shader compiles", w.shaderCompiles, (perf.shaderBase !== null && w.shaderCompiles > perf.shaderBase) ? "warn" : "") + kv("programs", w.programLinks) + kv("contexts", w.contexts) + kv("ctx lost", w.contextLostCount, w.contextLostCount ? "bad" : "") + '</div></div>';
    var hd = heapDelta();
    h += '<div class="sec"><b>Memory</b><div>' + kv("heap", m.memory.heapMB != null ? m.memory.heapMB + " MB" + (m.memory.heapLimitMB ? " / " + m.memory.heapLimitMB : "") : "n/a (needs Chromium)") + (hd ? kv("trend", (hd.perMin > 0 ? "+" : "") + hd.perMin + " MB/min", hd.perMin > 8 ? "warn" : "") : "") + kv("wasm", m.memory.wasmBytes ? (m.memory.wasmBytes / 1048576).toFixed(1) + " MB" : "–") + '</div></div>';
    if (t) {
      h += '<div class="sec"><b>Load</b><div>' + kv("first frame", secs(t.firstFrameMs)) + kv("first draw", secs(t.firstWebglDrawMs), t.firstWebglDrawMs > 4000 ? "warn" : "") + (t.navigation ? kv("load event", secs(t.navigation.loadEventMs)) : "") + kv("requests", t.resources.count) + kv("transfer", mb(t.resources.totalTransferKB)) + kv("decoded", mb(t.resources.totalDecodedKB)) +
        '<br>' + '<i class="muted">slowest</i> ' + t.resources.slowest.slice(0, 5).map(function (x) { return kv(x.name.split("/").pop(), secs(x.durationMs)); }).join("") +
        '<br>' + '<i class="muted">largest</i> ' + t.resources.largest.slice(0, 5).map(function (x) { return kv(x.name.split("/").pop(), mb(x.decodedKB)); }).join("") +
        (t.userMarks.length ? '<br><i class="muted">marks</i> ' + t.userMarks.slice(0, 10).map(function (x) { return kv(x.name, secs(x.atMs)); }).join("") : "") + '</div></div>';
    }
    var fs = findings(m);
    h += '<div class="sec" id="findings"><b>Findings</b><div>' + (fs.length ? '<ul>' + fs.map(function (x) { return '<li class="' + x.cls + '">' + esc(x.text) + '</li>'; }).join("") + '</ul>' : '<span class="muted">Collecting…</span>') + '</div></div>';
    if (perf.profile) h += renderProfile(perf.profile);
    else h += '<div class="sec"><b>Profile</b><div class="muted">Press ● Profile while playing to sample the main thread and list the hottest functions (Chromium; JS Self-Profiling API).' + (perf.profiling ? " Sampling…" : "") + '</div></div>';
    $("perfbody").innerHTML = h;
    $("perfhint").textContent = perf.profiling ? "profiling…" : "";
  }
  function renderProfile(p) {
    if (!p.supported) return '<div class="sec"><b>Profile</b><div class="warn">' + esc(p.reason) + '</div></div>';
    var maxSelf = p.hotFunctions[0] ? p.hotFunctions[0].selfPct : 1;
    var hot = p.hotFunctions.filter(function (x) { return x.selfMs > 0; }); if (!hot.length) hot = p.hotFunctions.slice(0, 5);
    var rows = hot.slice(0, 20).map(function (x) {
      return '<tr><td class="num">' + '<span class="bar" style="width:' + Math.max(2, Math.round(60 * x.selfPct / Math.max(1, maxSelf))) + 'px"></span>' + x.selfPct + '%</td><td class="num">' + x.selfMs + '</td><td class="num muted">' + x.totalPct + '%</td><td class="fn" title="' + esc(x.name) + '">' + esc(x.name) + '</td><td class="src" title="' + esc(x.url || "") + '">' + esc(x.url ? x.url.split("/").pop() + ":" + x.line : "native") + '</td></tr>';
    }).join("");
    var files = p.byFile.slice(0, 6).map(function (x) { return kv(x.url.charAt(0) === "(" ? x.url : (x.url.split("/").pop() || x.url), x.selfPct + "%"); }).join("");
    return '<div class="sec"><b>Profile</b><div>' + kv("window", secs(p.durationMs)) + kv("busy", p.busyPct + "%", p.busyPct > 85 ? "warn" : "") + kv("idle", p.idleMs + " ms") + kv("GC", p.gcMs + " ms", p.gcMs > p.durationMs * 0.05 ? "warn" : "") + kv("samples", p.samples) + kv("frames", p.framesRendered) + kv("draws", p.drawCalls) +
      '<br><i class="muted">by file</i> ' + files +
      '<table class="prof"><tr><th class="num">self</th><th class="num">ms</th><th class="num">total</th><th>function</th><th>source</th></tr>' + rows + '</table><div class="muted" style="margin-top:4px">' + esc(p.note) + '</div></div></div>';
  }
  function runProfile() {
    if (perf.profiling || !connected) return;
    var ms = Number($("profms").value) || 5000;
    perf.profiling = true; $("prof").textContent = "● " + (ms / 1000) + " s…"; $("prof").disabled = true; renderPerf();
    askGame("profile", { durationMs: ms }, ms + 10000).then(function (p) { perf.profile = p; }).catch(function (e) { perf.profile = { supported: false, reason: "Profile failed: " + e.message }; })
      .then(function () { perf.profiling = false; $("prof").textContent = "● Profile"; $("prof").disabled = false; renderPerf(); });
  }

  // ---- messages from the game hook ----
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.__gp !== 1 || e.source !== game.contentWindow) return;
    if (m.type === "hello") {
      env = m.env; connected = true; loadedAt = Date.now(); fpsHist = []; fpsWindow = [];
      $("conn").className = "dot on"; renderBadges(); drawSpark(); perfReset();
      addLog({ level: "sys", text: "— page loaded " + new Date().toLocaleTimeString() + (env.crossOriginIsolated ? " · isolated" : "") + " —", t: Date.now() });
    } else if (m.type === "console") addLog({ level: m.level, text: m.text, stack: m.stack, t: m.t });
    else if (m.type === "fps") onFps(m);
    else if (m.type === "result") {
      var local = uiPending[m.id];
      if (local) { delete uiPending[m.id]; clearTimeout(local.timer); m.ok ? local.resolve(m.value) : local.reject(new Error(m.error || "failed")); }
      else sendResult(m.id, m.ok, m.value, m.error);
    }
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
