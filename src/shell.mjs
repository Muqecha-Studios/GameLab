// Shell page rendered inside the canvas panel. Hosts the game in a same-origin
// iframe and draws the overlay: toolbar (reload, viewport presets, auto-reload,
// isolation, FPS sparkline, badges) and a console drawer. Relays agent
// commands arriving over SSE to the game hook and posts results back.

import { escapeHtml } from "./server.mjs";
import { VIEWPORTS, GROUP_LABELS } from "./devices.mjs";

export function renderShell({ title, source, gameSrc, isolation }) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg:#0f1115; --bar:#171a21; --bd:#262a33; --bd2:#343a47; --fg:#d7dae0; --mute:#8b93a3; --acc:#4fa3ff; --acc2:#7cbcff; --ok:#3fcf8e; --warn:#f2b84b; --err:#ff6b6b; --ctl:#1f232d; --ctl2:#272c38; --mono: ui-monospace, SFMono-Regular, Menlo, monospace; --ease:180ms cubic-bezier(.2,.7,.2,1); }
  * { box-sizing:border-box; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:12px system-ui, -apple-system, sans-serif; overflow:hidden; scrollbar-color:var(--bd2) transparent; }
  ::-webkit-scrollbar { width:10px; height:10px; } ::-webkit-scrollbar-thumb { background:var(--bd2); border-radius:6px; border:2px solid transparent; background-clip:padding-box; } ::-webkit-scrollbar-thumb:hover { background-color:#454d5e; } ::-webkit-scrollbar-track { background:transparent; }
  ::selection { background:rgba(79,163,255,.35); }
  :focus-visible { outline:2px solid var(--acc); outline-offset:1px; }
  #app { display:flex; flex-direction:column; height:100%; }
  #bar { display:flex; align-items:center; gap:6px; padding:0 10px; height:38px; background:var(--bar); border-bottom:1px solid var(--bd); flex:none; white-space:nowrap; overflow:hidden; }
  #bar .grow { flex:1; min-width:40px; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:baseline; gap:6px; }
  #bar .grow b { font-weight:600; flex:none; max-width:180px; overflow:hidden; text-overflow:ellipsis; } #bar .grow .muted { overflow:hidden; text-overflow:ellipsis; font-size:11px; direction:rtl; text-align:left; min-width:0; }
  .grp { display:inline-flex; align-items:center; gap:4px; flex:none; }
  .sep { width:1px; height:18px; background:var(--bd); margin:0 4px; flex:none; }
  .muted { color:var(--mute); }
  button, select, input[type=text], input[type=number], input[type=search], textarea { background:var(--ctl); color:var(--fg); border:1px solid var(--bd); border-radius:6px; padding:0 8px; height:26px; font:inherit; transition:background var(--ease), border-color var(--ease), color var(--ease); }
  button { cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
  button:hover, select:hover { background:var(--ctl2); border-color:var(--bd2); } button:active { background:#1a1e27; }
  button:disabled { opacity:.5; cursor:default; }
  button.primary { background:var(--acc); border-color:var(--acc); color:#04101f; font-weight:600; } button.primary:hover { background:var(--acc2); border-color:var(--acc2); }
  button.danger { color:var(--err); } button.danger:hover { border-color:#5a2a2a; }
  button.icon { width:26px; padding:0; justify-content:center; color:var(--mute); } button.icon:hover { color:var(--fg); }
  button svg { width:14px; height:14px; flex:none; }
  .tog { color:var(--mute); } .tog[aria-pressed=true] { color:var(--fg); background:#1d2a3d; border-color:#2f4b70; }
  #toggle { padding:0 7px; } #tcount { font:600 11px var(--mono); font-variant-numeric:tabular-nums; } #tcount:empty { display:none; }
  #toggle.warn { color:var(--warn); border-color:#4a3b14; } #toggle.err { color:var(--err); border-color:#5a2a2a; }
  #collapse { margin-left:2px; } #drawer.perf #collapse, #drawer:not(.perf) #collapse { display:inline-flex; }
  .tog i { width:7px; height:7px; border-radius:50%; background:var(--bd2); transition:background var(--ease); } .tog[aria-pressed=true] i { background:var(--acc); }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--err); flex:none; transition:background var(--ease); box-shadow:0 0 0 2px rgba(255,107,107,.15); }
  .dot.on { background:var(--ok); box-shadow:0 0 0 2px rgba(63,207,142,.15); }
  .badge { padding:2px 6px; border-radius:4px; border:1px solid var(--bd); color:var(--mute); font-size:10.5px; line-height:1; }
  .badge.ok { color:var(--ok); border-color:#264a3a; } .badge.bad { color:var(--err); border-color:#5a2a2a; } .badge.acc { color:var(--acc2); border-color:#2f4b70; }
  #dev { max-width:220px; } #dev .dn { overflow:hidden; text-overflow:ellipsis; } #dev .dd { color:var(--mute); font:11px var(--mono); }
  #fps { font:600 12.5px var(--mono); min-width:56px; text-align:right; font-variant-numeric:tabular-nums; }
  #fps.warn { color:var(--warn);} #fps.bad { color:var(--err);}
  #heap { font:11px var(--mono); color:var(--mute); min-width:48px; font-variant-numeric:tabular-nums; }
  #spark { width:96px; height:24px; background:#0c0e12; border:1px solid var(--bd); border-radius:4px; }
  #stage { flex:1; min-height:0; position:relative; display:flex; align-items:center; justify-content:center; background:#0a0b0e url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='8' height='8' fill='%230e1014'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%230e1014'/%3E%3C/svg%3E"); overflow:hidden; }
  #wrap { position:relative; }
  #game { border:0; background:#000; display:block; transform-origin:0 0; }
  #vplabel { position:absolute; right:8px; bottom:6px; font:11px var(--mono); color:var(--mute); pointer-events:none; background:rgba(10,11,14,.7); padding:2px 6px; border-radius:4px; font-variant-numeric:tabular-nums; }
  #vplabel .lab { color:var(--warn); }
  /* device popover */
  #devpop { position:fixed; z-index:20; top:40px; width:360px; max-height:calc(100vh - 60px); display:flex; flex-direction:column; background:#141821; border:1px solid var(--bd2); border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,.55); overflow:hidden; opacity:0; transform:translateY(-4px); pointer-events:none; transition:opacity var(--ease), transform var(--ease); }
  #devpop.open { opacity:1; transform:none; pointer-events:auto; }
  .dp-head { display:flex; gap:6px; padding:8px; border-bottom:1px solid var(--bd); } .dp-head input { flex:1; min-width:0; }
  #devlist { overflow:auto; flex:1; padding:4px 0; }
  .dg { padding:8px 12px 3px; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--mute); }
  .dev { display:grid; grid-template-columns:1fr auto; gap:0 8px; padding:5px 12px; cursor:pointer; align-items:center; transition:background var(--ease); } .dev:focus-visible { outline-offset:-2px; }
  .dev:hover { background:#1b2030; } .dev[aria-selected=true] { background:#1a2537; box-shadow:inset 2px 0 0 var(--acc); }
  .dev .dn { grid-column:1; font-weight:500; display:flex; gap:6px; align-items:center; } .dev .dd { grid-column:1; color:var(--mute); font:10.5px var(--mono); margin-top:1px; display:flex; gap:6px; flex-wrap:wrap; }
  .dev .da { grid-column:2; grid-row:1 / span 2; display:none; gap:2px; } .dev:hover .da, .dev[aria-selected=true] .da { display:inline-flex; }
  .dev .da button { height:22px; width:22px; }
  .tag { font-size:9.5px; padding:1px 4px; border-radius:3px; border:1px solid var(--bd2); color:var(--mute); font-weight:500; letter-spacing:.02em; } .tag.user { color:var(--acc2); border-color:#2f4b70; }
  .chip { padding:0 4px; border-radius:3px; background:#1f232d; } .chip.lab { color:var(--warn); background:#2a230f; }
  .dp-foot { display:flex; gap:6px; align-items:center; padding:8px; border-top:1px solid var(--bd); } .dp-foot .grow { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; font-size:11px; }
  #devedit { display:none; flex-direction:column; gap:8px; padding:10px 12px; overflow:auto; } #devpop.editing #devedit { display:flex; } #devpop.editing #devlist, #devpop.editing .dp-head, #devpop.editing .dp-foot { display:none; }
  #devedit .fr { display:grid; grid-template-columns:1fr 1fr; gap:6px 8px; } #devedit .fr.one { grid-template-columns:1fr; }
  #devedit label { display:flex; flex-direction:column; gap:3px; color:var(--mute); font-size:10.5px; } #devedit label span b { color:var(--fg); font-weight:500; }
  #devedit input[type=text], #devedit input[type=number], #devedit select, #devedit textarea { width:100%; padding:0 8px; } #devedit textarea { height:44px; padding:5px 8px; resize:vertical; }
  #devedit .cb { flex-direction:row; align-items:center; gap:6px; height:26px; color:var(--fg); }
  #devedit .cb input { accent-color:var(--acc); margin:0; }
  #devedit .act { display:flex; gap:6px; align-items:center; margin-top:2px; } #devedit .act .grow { flex:1; }
  #deverr { color:var(--err); font-size:11px; min-height:14px; }
  #devedit h4 { margin:0; font-size:12px; font-weight:600; } #devedit .hint { font-size:10.5px; color:var(--mute); }
  /* drawer */
  #drawer { flex:none; height:220px; display:flex; flex-direction:column; border-top:1px solid var(--bd); background:#0c0e12; }
  #drawer.hidden { display:none; }
  #grip { position:relative; height:6px; flex:none; cursor:row-resize; background:var(--bar); touch-action:none; }
  #grip::before { content:""; position:absolute; inset:-5px 0; }
  #grip::after { content:""; position:absolute; left:50%; top:2px; width:36px; height:2px; margin-left:-18px; border-radius:1px; background:var(--bd2); transition:background var(--ease), width var(--ease); }
  #grip:hover::after, body.dragging #grip::after { background:var(--acc); width:56px; }
  body.dragging { cursor:row-resize; user-select:none; } body.dragging #game, body.dragging #stage { pointer-events:none; }
  #dbar { display:flex; gap:6px; align-items:center; padding:5px 8px; border-bottom:1px solid var(--bd); }
  #dbar .f, #dbar .tab { height:22px; padding:0 8px; color:var(--mute); background:transparent; border-color:transparent; } #dbar .f:hover, #dbar .tab:hover { color:var(--fg); background:var(--ctl2); }
  #dbar .f.on { color:var(--fg); background:var(--ctl2); border-color:var(--bd2); } #dbar .tab { font-weight:600; } #dbar .tab.on { color:var(--fg); background:#1d2a3d; border-color:#2f4b70; }
  #dbar .grow { flex:1; }
  #search { flex:1; background:#151821; min-width:60px; height:22px; }
  #count { font:11px var(--mono); font-variant-numeric:tabular-nums; }
  #log { flex:1; overflow:auto; font:11.5px/1.5 var(--mono); padding:2px 0; }
  .row { display:flex; gap:8px; padding:1px 10px; border-bottom:1px solid #12151b; white-space:pre-wrap; word-break:break-word; }
  .row .t { color:var(--mute); flex:none; font-variant-numeric:tabular-nums; } .row .n { color:var(--mute); flex:none; min-width:26px; text-align:right; }
  .row.warn { color:var(--warn); background:#1a1708; } .row.error { color:#ff8a8a; background:#1c0e0e; } .row.debug { color:var(--mute); } .row.info { color:#9cc7ff; }
  .row.sys { color:var(--acc2); justify-content:center; background:#0f1520; }
  .row.event { color:var(--fg); background:#0f1a15; } .row.event .ev { color:var(--ok); flex:none; font-size:10px; text-transform:uppercase; letter-spacing:.06em; padding-top:2px; } .row.event .evn { font-weight:600; } .row.event .evd { color:var(--mute); }
  .row .stack { display:block; color:#b07a7a; font-size:10.5px; margin-top:2px; }
  #empty { color:var(--mute); text-align:center; padding:22px 20px; line-height:1.6; } #empty kbd { font:inherit; color:var(--fg); border:1px solid var(--bd2); border-radius:3px; padding:0 4px; }
  #perf { flex:1; overflow:auto; display:none; font:11.5px/1.5 var(--mono); padding:6px 10px 10px; }
  #drawer.perf #perf { display:block; } #drawer.perf #log, #drawer.perf .con { display:none; }
  #graph { flex:1; display:none; position:relative; min-height:0; overflow:auto; }
  #drawer.graph #graph { display:block; } #drawer.graph #log, #drawer.graph .con, #drawer.graph #resetm, #drawer.graph #profms, #drawer.graph #prof { display:none; }
  .gr { display:none; } #drawer.graph .gr { display:inline-flex; } #drawer.graph select.gr { display:inline-block; }
  #glanes { gap:4px; } #glanes .tog { height:22px; padding:0 8px 0 6px; color:var(--mute); } #glanes .tog[aria-pressed=true] { color:var(--fg); }
  #gc { display:block; width:100%; cursor:crosshair; touch-action:none; }
  #gempty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.6; pointer-events:none; }
  .sec { display:grid; grid-template-columns:64px 1fr; gap:2px 10px; padding:4px 0; border-bottom:1px solid #12151b; }
  .sec > b { color:var(--mute); font-weight:600; }
  .kv { display:inline-block; margin-right:14px; } .kv i { color:var(--mute); font-style:normal; margin-right:4px; }
  .kv.warn { color:var(--warn);} .kv.bad { color:var(--err);}
  #findings li { margin:1px 0; } #findings li.warn { color:var(--warn);} #findings li.bad { color:#ff8a8a;} #findings li.info { color:#9cc7ff;}
  #findings ul { margin:0; padding-left:16px; }
  table.prof { border-collapse:collapse; width:100%; margin-top:4px; } table.prof td, table.prof th { text-align:left; padding:1px 8px 1px 0; white-space:nowrap; } table.prof th { color:var(--mute); font-weight:600; }
  table.prof td.num, table.prof th.num { text-align:right; font-variant-numeric:tabular-nums; } table.prof td.fn { width:100%; max-width:420px; overflow:hidden; text-overflow:ellipsis; } table.prof td.src { color:var(--mute); max-width:280px; overflow:hidden; text-overflow:ellipsis; }
  .bar { display:inline-block; height:8px; background:var(--acc); vertical-align:middle; margin-right:4px; border-radius:2px; }
  #perfhint { color:var(--mute); }
  #prof i { width:7px; height:7px; border-radius:50%; background:#04101f; } #prof.busy i { background:var(--err); animation:pulse 1s infinite; } @keyframes pulse { 50% { opacity:.3; } }
  #drawer:not(.perf) #resetm, #drawer:not(.perf) #profms, #drawer:not(.perf) #prof, #drawer:not(.perf) #perfhint { display:none; }
  @media (max-width: 1000px) { #bar .grow .muted, #heap { display:none; } }
  @media (max-width: 820px) { .grp.env, #spark { display:none; } #bar .grow b { max-width:110px; } }
  @media (max-width: 640px) { #dev .dd, .tog span { display:none; } #dev { max-width:130px; } }
  @media (prefers-reduced-motion: reduce) { *, ::before, ::after { transition:none !important; animation:none !important; } }
</style>
</head>
<body>
<div id="app">
  <div id="bar">
    <span class="dot" id="conn" title="Hook connection"></span>
    <span class="grow"><b id="title">${escapeHtml(title)}</b><span class="muted" id="source">${escapeHtml(source)}</span></span>
    <span class="grp env" id="badges"></span>
    <span class="sep"></span>
    <span class="grp">
      <button id="dev" aria-haspopup="dialog" aria-expanded="false" title="Device profile: resolution, pixel ratio, user agent, touch, cores. Click to change or add your own."><span class="dn">Fill panel</span><span class="dd"></span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6l4 4 4-4"/></svg></button>
      <button id="rot" class="icon" title="Rotate (portrait / landscape)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.7"/><path d="M13.5 2.5v3.2h-3.2"/><path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.3"/><path d="M2.5 13.5v-3.2h3.2"/></svg></button>
    </span>
    <span class="grp">
      <button id="auto" class="tog" aria-pressed="true" title="Reload when files in the watched folder change"><i></i><span>auto</span></button>
      <button id="iso" class="tog" aria-pressed="false" title="Send COOP/COEP headers (SharedArrayBuffer / Godot threads). Reloads the shell."><i></i><span>isolated</span></button>
    </span>
    <span class="sep"></span>
    <span class="grp">
      <canvas id="spark" width="192" height="48" title="FPS, last 32 s"></canvas>
      <span id="fps">-- fps</span><span id="heap"></span>
    </span>
    <span class="sep"></span>
    <span class="grp">
      <button id="toggle" class="tog" aria-pressed="true" aria-controls="drawer" title="Show / hide the Console & Perf drawer (D)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 9.5h12"/></svg><span id="tcount"></span></button>
      <button id="reload" class="primary" title="Reload game (R)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3.2h-3.2"/></svg>Reload</button>
    </span>
  </div>
  <div id="devpop" role="dialog" aria-label="Device profile" aria-hidden="true">
    <div class="dp-head"><input type="search" id="devsearch" placeholder="Search devices or type 1280x720" aria-label="Search devices" /><button id="devnew" title="Create a profile of your own">New</button></div>
    <div id="devlist" role="listbox" aria-label="Device profiles"></div>
    <div class="dp-foot"><span class="grow muted" id="devinfo"></span><button id="devlab" title="Open this profile in the Playwright lab: real DPR/UA/touch plus CPU slowdown and network throttling">Run in lab</button></div>
    <form id="devedit" autocomplete="off">
      <h4 id="devedit-title">New profile</h4>
      <div class="fr"><label><span>Name</span><input type="text" name="name" required maxlength="60" /></label><label><span>Group</span><select name="group"></select></label></div>
      <div class="fr"><label><span>Width <b>css px</b></span><input type="number" name="width" min="120" max="7680" required /></label><label><span>Height <b>css px</b></span><input type="number" name="height" min="120" max="4320" required /></label></div>
      <div class="fr"><label><span>Pixel ratio</span><input type="number" name="dpr" min="0.5" max="5" step="0.05" /></label><label><span>CPU slowdown <b>lab only</b></span><input type="number" name="cpu" min="1" max="20" step="0.5" /></label></div>
      <div class="fr"><label><span>Network <b>lab only</b></span><select name="network"><option value="none">none (unthrottled)</option><option value="wifi">wifi</option><option value="4g">4g</option><option value="fast-3g">fast-3g</option><option value="slow-3g">slow-3g</option><option value="offline">offline</option></select></label><label><span>Cores · Memory GB</span><span style="display:flex;gap:6px"><input type="number" name="cores" min="1" max="64" /><input type="number" name="memoryGB" min="0.25" max="128" step="0.25" /></span></label></div>
      <div class="fr"><label class="cb"><input type="checkbox" name="touch" /> Touch screen</label><label class="cb"><input type="checkbox" name="mobile" /> Mobile (viewport meta, UA hints)</label></div>
      <div class="fr one"><label><span>User agent <b>optional</b></span><input type="text" name="ua" placeholder="Leave empty to keep the browser's" /></label></div>
      <div class="fr one"><label><span>Note</span><textarea name="note" maxlength="200"></textarea></label></div>
      <div class="hint" id="devedit-hint"></div>
      <div id="deverr" role="alert"></div>
      <div class="act"><button type="button" id="devcancel">Cancel</button><span class="grow"></span><button type="submit" class="primary" id="devsave">Save profile</button></div>
    </form>
  </div>
  <div id="stage"><div id="wrap"><iframe id="game" src="${escapeHtml(gameSrc)}" allow="autoplay; fullscreen; gamepad; xr-spatial-tracking; cross-origin-isolated" allowfullscreen></iframe></div><span id="vplabel"></span></div>
  <div id="drawer">
    <div id="grip"></div>
    <div id="dbar">
      <button class="tab on" data-tab="console">Console</button><button class="tab" data-tab="perf">Perf</button><button class="tab" data-tab="graph">Timeline</button><span class="sep"></span>
      <button class="f con on" data-f="all">All</button><button class="f con" data-f="log">Log</button><button class="f con" data-f="warn">Warn</button><button class="f con" data-f="error">Errors</button><button class="f con" data-f="event">Events</button>
      <input id="search" class="con" type="search" placeholder="Filter…" aria-label="Filter console" />
      <span class="muted con" id="count"></span>
      <button id="clear" class="con">Clear</button>
      <span id="glanes" class="gr" role="group" aria-label="Series"></span>
      <span id="perfhint" class="grow"></span>
      <select id="gwin" class="gr" title="Time window"><option value="30000">30 s</option><option value="60000" selected>1 min</option><option value="300000">5 min</option><option value="0">All</option></select>
      <button id="gcsv" class="gr" title="Download every sample as CSV">CSV</button>
      <button id="resetm" title="Reset hitch log and frame-time samples">Reset</button>
      <select id="profms" title="Profile duration"><option value="3000">3 s</option><option value="5000" selected>5 s</option><option value="10000">10 s</option><option value="20000">20 s</option></select>
      <button id="prof" class="primary" title="Sample the main thread (JS Self-Profiling API) and list hot functions"><i></i>Profile</button>
      <button id="collapse" class="icon" title="Hide drawer (D)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6l4 4 4-4"/></svg></button>
    </div>
    <div id="log"><div id="empty">No console output yet.<br><span class="muted">console.*, errors, unhandled rejections and game events from the page appear here.</span></div></div>
    <div id="perf"><div id="perfbody" class="muted" style="padding:12px 0">Waiting for the game hook…</div></div>
    <div id="graph"><canvas id="gc" aria-label="Metrics over time"></canvas><div id="gempty" class="muted">Collecting samples…<br><span>FPS, frame time, draw calls, heap and engine timings are recorded every 0.5 s while the game runs.</span></div></div>
  </div>
</div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var game = $("game"), wrap = $("wrap"), stage = $("stage"), logEl = $("log");
  var VIEWPORTS = ${JSON.stringify(VIEWPORTS)};
  var GROUPS = ${JSON.stringify(GROUP_LABELS)};
  var state = { viewport: "fill", rotated: false, autoReload: true, isolation: ${JSON.stringify(!!isolation)}, device: null, emulation: null };
  var devices = [], devSel = null; // devSel: id of the highlighted row in the popover
  var env = null, connected = false, loadedAt = Date.now();
  var logs = [], filter = "all", query = "", counts = { log: 0, info: 0, warn: 0, error: 0, debug: 0 };
  var fpsHist = [], fpsWindow = []; // fpsWindow: last ~60s of samples
  var hist = [], HIST_MAX = 2400, lastEngine = null, marks = []; // hist: 0.5 s samples for the Timeline tab (~20 min)
  var MAXLOGS = 3000;

  // ---- viewport ----
  function applyViewport() {
    var dims = VIEWPORTS[state.viewport] || null;
    if (state.viewport.indexOf("x") > 0 && !dims) { var p = state.viewport.split("x"); dims = [Number(p[0]), Number(p[1])]; }
    if (!dims) {
      wrap.style.width = "100%"; wrap.style.height = "100%";
      game.style.width = "100%"; game.style.height = "100%"; game.style.transform = "none";
      $("vplabel").textContent = stage.clientWidth + "\u00d7" + stage.clientHeight;
      return;
    }
    var w = state.rotated ? dims[1] : dims[0], h = state.rotated ? dims[0] : dims[1];
    var s = Math.min((stage.clientWidth - 16) / w, (stage.clientHeight - 16) / h, 1);
    game.style.width = w + "px"; game.style.height = h + "px"; game.style.transform = "scale(" + s + ")";
    wrap.style.width = Math.round(w * s) + "px"; wrap.style.height = Math.round(h * s) + "px";
    var em = state.emulation, txt = w + "\u00d7" + h + " @ " + Math.round(s * 100) + "%";
    if (em) {
      txt += " \u00b7 dpr " + em.dpr + (em.touch ? " \u00b7 touch" : "");
      var lab = []; if (em.cpu > 1) lab.push("cpu \u00d7" + em.cpu); if (em.network && em.network !== "none" && em.network !== "wifi") lab.push(em.network);
      $("vplabel").innerHTML = esc(txt) + (lab.length ? ' \u00b7 <span class="lab">' + esc(lab.join(" \u00b7 ") + " in lab") + "</span>" : "");
      return;
    }
    $("vplabel").textContent = txt;
  }
  new ResizeObserver(applyViewport).observe(stage);
  $("rot").onclick = function () { postState({ rotated: !state.rotated }); };
  $("auto").onclick = function () { postState({ autoReload: this.getAttribute("aria-pressed") !== "true" }); };
  $("iso").onclick = function () { postState({ isolation: this.getAttribute("aria-pressed") !== "true" }); };
  $("reload").onclick = reload;
  window.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.target !== document.body) return;
    if (e.key === "r" || e.key === "R") reload();
    if (e.key === "d" || e.key === "D") setDrawer($("drawer").classList.contains("hidden"));
  });

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
    var emuChanged = patch.emulation !== undefined && JSON.stringify(patch.emulation) !== JSON.stringify(state.emulation);
    Object.assign(state, patch);
    $("auto").setAttribute("aria-pressed", String(!!state.autoReload)); $("iso").setAttribute("aria-pressed", String(!!state.isolation));
    renderDevButton(); applyViewport();
    if (devpop.classList.contains("open")) renderDevList();
    // DPR/UA/touch overrides are applied by the hook at page start, so a profile change needs a game reload.
    if (emuChanged && connected) { addLog({ level: "sys", text: state.emulation ? "\u2014 emulating " + state.emulation.name + ", reloading \u2014" : "\u2014 emulation off, reloading \u2014", t: Date.now() }); reload(); }
  }

  // ---- device profiles ----
  var devpop = $("devpop"), devBtn = $("dev");
  function curDevice() { for (var i = 0; i < devices.length; i++) if (devices[i].id === state.device) return devices[i]; return null; }
  function renderDevButton() {
    var d = curDevice(), dn = devBtn.querySelector(".dn"), dd = devBtn.querySelector(".dd");
    if (d) { dn.textContent = d.name; dd.textContent = (state.rotated ? d.height + "\u00d7" + d.width : d.width + "\u00d7" + d.height); }
    else if (state.viewport !== "fill") { dn.textContent = "Custom"; dd.textContent = state.viewport.replace("x", "\u00d7"); }
    else { dn.textContent = "Fill panel"; dd.textContent = ""; }
  }
  function loadDevices() {
    return fetch("/__gp/api/devices").then(function (r) { return r.json(); }).then(function (j) { devices = j.devices || []; devFile = j.userFile; renderDevButton(); if (devpop.classList.contains("open")) renderDevList(); });
  }
  var devFile = "";
  function chips(d) {
    var h = '<span class="chip">' + d.width + "\u00d7" + d.height + '</span><span class="chip">' + d.dpr + "\u00d7</span>";
    if (d.touch) h += '<span class="chip">touch</span>';
    if (d.cpu > 1) h += '<span class="chip lab" title="CPU slowdown, applied in the lab">cpu \u00d7' + d.cpu + "</span>";
    if (d.network && d.network !== "none" && d.network !== "wifi") h += '<span class="chip lab" title="Network preset, applied in the lab">' + esc(d.network) + "</span>";
    return h;
  }
  function renderDevList() {
    var q = $("devsearch").value.trim().toLowerCase(), list = $("devlist"), h = "";
    var custom = /^(\d{3,4})\s*[x\u00d7]\s*(\d{3,4})$/.exec(q);
    var fillSel = !state.device && state.viewport === "fill";
    if (!q) h += '<div class="dev" tabindex="0" data-vp="fill" role="option" aria-selected="' + fillSel + '"><span class="dn">Fill panel</span><span class="dd"><span class="chip">' + stage.clientWidth + "\u00d7" + stage.clientHeight + '</span><span class="chip">no emulation</span></span></div>';
    if (custom) h += '<div class="dev" tabindex="0" data-vp="' + custom[1] + "x" + custom[2] + '" role="option" aria-selected="false"><span class="dn">Custom size</span><span class="dd"><span class="chip">' + custom[1] + "\u00d7" + custom[2] + '</span><span class="chip">no emulation</span></span></div>';
    else if (!state.device && state.viewport !== "fill" && !q) h += '<div class="dev" tabindex="0" data-vp="' + esc(state.viewport) + '" role="option" aria-selected="true"><span class="dn">Custom size</span><span class="dd"><span class="chip">' + esc(state.viewport.replace("x", "\u00d7")) + '</span></span></div>';
    var byGroup = {};
    devices.forEach(function (d) {
      if (q && (d.name + " " + d.id + " " + d.group + " " + (d.note || "")).toLowerCase().indexOf(q) < 0) return;
      (byGroup[d.group] = byGroup[d.group] || []).push(d);
    });
    Object.keys(GROUPS).forEach(function (g) {
      if (!byGroup[g]) return;
      h += '<div class="dg">' + esc(GROUPS[g]) + "</div>";
      byGroup[g].forEach(function (d) {
        var sel = d.id === state.device;
        h += '<div class="dev" tabindex="0" data-id="' + esc(d.id) + '" role="option" aria-selected="' + sel + '" title="' + esc(d.note || "") + '"><span class="dn">' + esc(d.name) + (d.user ? '<span class="tag user">' + (d.overrides ? "edited" : "yours") + "</span>" : "") + '</span><span class="dd">' + chips(d) + "</span>" +
          '<span class="da">' + (d.user ? '<button class="icon" data-act="edit" title="Edit"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11.5 2.5l2 2L5 13H3v-2z"/></svg></button>' : '<button class="icon" data-act="dup" title="Duplicate and edit"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg></button>') +
          (d.user ? '<button class="icon danger" data-act="del" title="' + (d.overrides ? "Revert to the built-in profile" : "Delete") + '"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5l.7 8a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-8"/></svg></button>' : "") + "</span></div>";
      });
    });
    if (!h) h = '<div id="empty">No profile matches. Type a size like <kbd>1280x720</kbd> or create one with <kbd>New</kbd>.</div>';
    list.innerHTML = h;
    var d = curDevice();
    $("devinfo").textContent = d ? (d.note || "") + (d.cpu > 1 || (d.network && d.network !== "none" && d.network !== "wifi") ? (d.note ? " \u00b7 " : "") + "CPU/network throttling only applies in the lab" : "") : "Profiles you save live in " + devFile;
    $("devlab").disabled = !d && state.viewport === "fill";
  }
  function openDevPop() {
    var r = devBtn.getBoundingClientRect();
    devpop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 368)) + "px";
    devpop.classList.remove("editing"); devpop.classList.add("open"); devpop.setAttribute("aria-hidden", "false"); devBtn.setAttribute("aria-expanded", "true");
    renderDevList(); loadDevices(); setTimeout(function () { $("devsearch").focus(); }, 0);
  }
  function closeDevPop() { devpop.classList.remove("open", "editing"); devpop.setAttribute("aria-hidden", "true"); devBtn.setAttribute("aria-expanded", "false"); }
  devBtn.onclick = function () { devpop.classList.contains("open") ? closeDevPop() : openDevPop(); };
  window.addEventListener("resize", function () { if (devpop.classList.contains("open")) { var r = devBtn.getBoundingClientRect(); devpop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 368)) + "px"; } });
  document.addEventListener("mousedown", function (e) { if (devpop.classList.contains("open") && !devpop.contains(e.target) && !devBtn.contains(e.target)) closeDevPop(); });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape" && devpop.classList.contains("open")) { devpop.classList.contains("editing") ? cancelEdit() : closeDevPop(); } });
  $("devsearch").oninput = renderDevList;
  $("devsearch").onkeydown = function (e) { if (e.key === "Enter") { var first = $("devlist").querySelector(".dev"); if (first) first.click(); } };
  $("devlist").onkeydown = function (e) { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("dev")) { e.preventDefault(); e.target.click(); } };
  $("devlist").onclick = function (e) {
    var act = e.target.closest("[data-act]"), row = e.target.closest(".dev");
    if (!row) return;
    if (act) { e.stopPropagation(); var d = byId(row.dataset.id); if (act.dataset.act === "del") return deleteDevice(d); return editDevice(d, act.dataset.act === "dup"); }
    if (row.dataset.vp) postState({ device: null, viewport: row.dataset.vp }); else postState({ device: row.dataset.id });
    closeDevPop();
  };
  function byId(id) { for (var i = 0; i < devices.length; i++) if (devices[i].id === id) return devices[i]; return null; }
  $("devlab").onclick = function () {
    var d = curDevice(); var btn = this; btn.disabled = true; btn.textContent = "Opening lab\u2026";
    fetch("/__gp/api/lab/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: d ? d.id : null, landscape: state.rotated }) })
      .then(function (r) { return r.json(); }).then(function (j) { addLog({ level: "sys", text: j.error ? "\u2014 lab failed: " + j.error + " \u2014" : "\u2014 lab opened" + (d ? " as " + d.name : "") + (j.cpu > 1 ? " \u00b7 cpu \u00d7" + j.cpu : "") + (j.network ? " \u00b7 " + (j.network.preset || "throttled") : "") + " \u2014", t: Date.now() }); })
      .catch(function (e) { addLog({ level: "sys", text: "\u2014 lab failed: " + e.message + " \u2014", t: Date.now() }); })
      .then(function () { btn.disabled = false; btn.textContent = "Run in lab"; closeDevPop(); });
  };
  // editor
  var form = $("devedit"), editing = null;
  (function () { var sel = form.elements.group; Object.keys(GROUPS).forEach(function (g) { var o = document.createElement("option"); o.value = g; o.textContent = GROUPS[g]; sel.appendChild(o); }); })();
  function editDevice(d, dup) {
    editing = d && !dup ? d.id : null;
    var src = d || { name: "", group: "custom", width: 1280, height: 720, dpr: 1, cpu: 1, network: "none", cores: 8, memoryGB: 8, touch: false, mobile: false, ua: "", note: "" };
    $("devedit-title").textContent = d ? (dup ? "Duplicate " + d.name : "Edit " + d.name) : "New profile";
    $("devedit-hint").textContent = d && !dup && d.seeded ? "This is a built-in profile; saving stores your version on top of it (revert with the trash icon)." : dup ? "Saved as a new profile of your own." : "Saved to " + devFile + " and available to the CLI, MCP tools and exports.";
    ["name", "width", "height", "dpr", "cpu", "cores", "memoryGB", "ua", "note"].forEach(function (k) { form.elements[k].value = src[k] == null ? "" : src[k]; });
    if (dup) form.elements.name.value = src.name + " copy";
    form.elements.group.value = src.group || "custom"; form.elements.network.value = src.network || "none";
    form.elements.touch.checked = !!src.touch; form.elements.mobile.checked = !!src.mobile;
    $("deverr").textContent = "";
    devpop.classList.add("editing"); setTimeout(function () { form.elements.name.focus(); form.elements.name.select(); }, 0);
  }
  function cancelEdit() { devpop.classList.remove("editing"); setTimeout(function () { $("devsearch").focus(); }, 0); }
  $("devnew").onclick = function () { editDevice(null, false); };
  $("devcancel").onclick = cancelEdit;
  form.onsubmit = function (e) {
    e.preventDefault();
    var body = { id: editing || undefined, group: form.elements.group.value, network: form.elements.network.value, touch: form.elements.touch.checked, mobile: form.elements.mobile.checked };
    ["name", "width", "height", "dpr", "cpu", "cores", "memoryGB", "ua", "note"].forEach(function (k) { var v = form.elements[k].value; if (v !== "") body[k] = v; });
    if (!editing) { var seeded = byId(slug(body.name)); if (seeded && !seeded.user && seeded.name !== body.name) body.id = slug(body.name) + "-2"; }
    $("devsave").disabled = true;
    fetch("/__gp/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) { $("deverr").textContent = j.error; return; }
      devices = j.devices; renderDevButton(); closeDevPop();
      if (!editing || j.saved.id !== state.device) postState({ device: j.saved.id });
      addLog({ level: "sys", text: "\u2014 saved device profile " + j.saved.name + " \u2014", t: Date.now() });
    }).catch(function (err) { $("deverr").textContent = err.message; }).then(function () { $("devsave").disabled = false; });
  };
  function slug(n) { return String(n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "device"; }
  function deleteDevice(d) {
    if (!d || !confirm(d.overrides ? "Revert \u201c" + d.name + "\u201d to the built-in profile?" : "Delete profile \u201c" + d.name + "\u201d?")) return;
    fetch("/__gp/api/devices?id=" + encodeURIComponent(d.id), { method: "DELETE" }).then(function (r) { return r.json(); }).then(function (j) { if (j.devices) devices = j.devices; renderDevButton(); renderDevList(); });
  }

  // ---- badges / env ----
  function renderBadges() {
    var b = $("badges"); b.innerHTML = "";
    if (!env) return;
    var add = function (txt, cls, title) { var s = document.createElement("span"); s.className = "badge " + (cls || ""); s.textContent = txt; if (title) s.title = title; b.appendChild(s); };
    add(env.crossOriginIsolated ? "isolated" : "not isolated", env.crossOriginIsolated ? "ok" : "", "crossOriginIsolated=" + env.crossOriginIsolated + " · SharedArrayBuffer=" + env.sharedArrayBuffer);
    if (env.webgl) add(env.webgl.api, "ok", env.webgl.renderer + " · max tex " + env.webgl.maxTextureSize); else add("no WebGL", "bad");
    if (env.webgpu) add("WebGPU", "ok");
    var emu = env.emulation;
    if (emu && emu.applied && emu.applied.length) add("as " + emu.name, "acc", "Emulating " + emu.name + ": " + emu.applied.join(", ") + (emu.labOnly && emu.labOnly.length ? " \u00b7 lab only: " + emu.labOnly.join(", ") : ""));
    else add("dpr " + env.devicePixelRatio, "", env.userAgent || "");
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
    hist.push({ t: m.t || Date.now(), fps: m.fps, worstMs: m.worstMs, heapMB: m.heapMB, drawCalls: m.drawCalls, eng: lastEngine }); if (hist.length > HIST_MAX) hist.shift();
    if (perf.tab === "graph") scheduleGraph();
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
      device: state.device, emulation: state.emulation,
      isolationRequested: state.isolation, autoReload: state.autoReload,
    };
  }

  // ---- console ----
  function fmtTime(t) { var d = new Date(t); return ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2) + "." + ("00" + d.getMilliseconds()).slice(-3); }
  function matches(e) {
    if (e.level === "sys") return true;
    if (filter === "warn" && e.level !== "warn") return false;
    if (filter === "error" && e.level !== "error") return false;
    if (filter === "event" && e.level !== "event") return false;
    if (filter === "log" && (e.level === "warn" || e.level === "error")) return false;
    if (query && (e.text + " " + (e.name || "")).toLowerCase().indexOf(query) < 0) return false;
    return true;
  }
  function rowFor(e) {
    var r = document.createElement("div"); r.className = "row " + e.level;
    if (e.level === "sys") { r.textContent = e.text; return r; }
    var t = document.createElement("span"); t.className = "t"; t.textContent = fmtTime(e.t);
    var n = document.createElement("span"); n.className = "n"; n.textContent = e.count > 1 ? "×" + e.count : "";
    var m = document.createElement("span");
    if (e.level === "event") { var l = document.createElement("span"); l.className = "ev"; l.textContent = "event"; var nm = document.createElement("span"); nm.className = "evn"; nm.textContent = e.name; var dd = document.createElement("span"); dd.className = "evd"; dd.textContent = e.text ? " " + e.text : ""; r.appendChild(t); r.appendChild(n); r.appendChild(l); r.appendChild(nm); r.appendChild(dd); e.row = r; return r; }
    m.textContent = e.text;
    if (e.stack) { var s = document.createElement("span"); s.className = "stack"; s.textContent = String(e.stack).split("\\n").slice(1, 5).join("\\n"); m.appendChild(s); }
    r.appendChild(t); r.appendChild(n); r.appendChild(m);
    e.row = r; return r;
  }
  function rerender() {
    logEl.innerHTML = "";
    var shown = 0;
    for (var i = 0; i < logs.length; i++) if (matches(logs[i])) { logEl.appendChild(rowFor(logs[i])); shown++; }
    if (!shown) { var em = document.createElement("div"); em.id = "empty"; em.innerHTML = logs.length ? "Nothing matches the filter." : 'No console output yet.<br><span class="muted">console.*, errors, unhandled rejections and game events from the page appear here.</span>'; logEl.appendChild(em); }
    logEl.scrollTop = logEl.scrollHeight;
    updateCount();
  }
  function updateCount() {
    $("count").textContent = logs.length ? counts.error + " err · " + counts.warn + " warn · " + logs.length + " total" : "";
    var total = counts.error + counts.warn;
    $("tcount").textContent = total ? String(total) : "";
    $("toggle").className = "tog" + (counts.error ? " err" : counts.warn ? " warn" : "");
    $("toggle").title = "Show / hide the Console & Perf drawer (D)" + (total ? " \u00b7 " + counts.error + " errors, " + counts.warn + " warnings" : "");
  }
  function addLog(e) {
    var last = logs[logs.length - 1];
    if (last && last.level === e.level && last.text === e.text && last.name === e.name && e.level !== "sys") {
      last.count = (last.count || 1) + 1; last.t = e.t;
      if (last.row) { last.row.children[1].textContent = "×" + last.count; last.row.children[0].textContent = fmtTime(e.t); }
      return;
    }
    e.count = 1; logs.push(e);
    if (e.level !== "sys" && e.level !== "event") counts[e.level] = (counts[e.level] || 0) + 1;
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
  function setDrawer(open) { $("drawer").classList.toggle("hidden", !open); $("toggle").setAttribute("aria-pressed", String(open)); applyViewport(); if (open && perf.tab === "perf") perfTick(); }
  $("toggle").onclick = function () { setDrawer($("drawer").classList.contains("hidden")); };
  $("collapse").onclick = function () { setDrawer(false); };
  (function grip() {
    // Pointer capture keeps the drag alive when the cursor crosses the game iframe (which would otherwise swallow the move/up events).
    var g = $("grip"), d = $("drawer"), startY, startH, raf = 0;
    var saved = Number(localStorage.getItem("gp.drawerH")); if (saved >= 80) d.style.height = saved + "px";
    g.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); g.setPointerCapture(e.pointerId);
      startY = e.clientY; startH = d.offsetHeight; document.body.classList.add("dragging");
    });
    g.addEventListener("pointermove", function (e) {
      if (!g.hasPointerCapture(e.pointerId)) return;
      var h = Math.max(80, Math.min(window.innerHeight - 120, startH + (startY - e.clientY)));
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; d.style.height = h + "px"; applyViewport(); });
    });
    function up(e) { if (!g.hasPointerCapture(e.pointerId)) return; g.releasePointerCapture(e.pointerId); document.body.classList.remove("dragging"); localStorage.setItem("gp.drawerH", String(d.offsetHeight)); }
    g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
    g.addEventListener("dblclick", function () { d.style.height = "220px"; localStorage.removeItem("gp.drawerH"); applyViewport(); });
    g.title = "Drag to resize \u00b7 double-click to reset";
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
  var perf = { tab: "console", timer: null, prevM: null, prevT: 0, rates: {}, heapHist: [], timeline: null, lastM: null, profile: null, profiling: false, shaderBase: null, shaderBaseAt: 0, events: [], nodeHist: [] };
  function perfReset() { perf.prevM = null; perf.rates = {}; perf.heapHist = []; perf.timeline = null; perf.lastM = null; perf.profile = null; perf.shaderBase = null; perf.events = []; perf.nodeHist = []; }
  function setTab(t) {
    perf.tab = t;
    Array.prototype.forEach.call(document.querySelectorAll("#dbar .tab"), function (b) { b.classList.toggle("on", b.dataset.tab === t); });
    $("drawer").classList.toggle("perf", t === "perf"); $("drawer").classList.toggle("graph", t === "graph");
    if (t === "graph") { var want = activeLanes().length * 54 + 14 + 18 + 40, have = parseInt($("drawer").style.height || "220", 10); if (have < want) $("drawer").style.height = Math.round(Math.min(window.innerHeight * 0.6, want)) + "px"; renderLaneChips(); scheduleGraph(); }
    if (t === "perf") { if (parseInt($("drawer").style.height || "220", 10) < 340) $("drawer").style.height = Math.round(Math.min(window.innerHeight * 0.48, 460)) + "px"; perfTick(); }
  }
  Array.prototype.forEach.call(document.querySelectorAll("#dbar .tab"), function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
  $("resetm").onclick = function () { askGame("reset_hitches").then(function () { perf.heapHist = []; perfTick(); }).catch(function () {}); };
  $("prof").onclick = runProfile;
  setInterval(function () { if (connected && !document.hidden) perfTick(); }, 1000);

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
      var gm = m.game && m.game.present && m.game.metrics && !m.game.metrics.__error && !m.game.metrics.__pending ? m.game.metrics : null;
      var ent = gm ? (gm.nodes != null ? gm.nodes : gm.entities != null ? gm.entities : gm.objects) : null;
      if (typeof ent === "number") { perf.nodeHist.push({ t: now, n: ent }); while (perf.nodeHist.length && now - perf.nodeHist[0].t > 60000) perf.nodeHist.shift(); }
      lastEngine = gm ? engineSample(gm, ent) : null;
      if (m.memory && m.memory.heapMB != null) { perf.heapHist.push({ t: now, mb: m.memory.heapMB }); while (perf.heapHist.length && now - perf.heapHist[0].t > 60000) perf.heapHist.shift(); }
      if (!perf.timeline || (perf.timeline.firstWebglDrawMs === null && m.uptimeMs < 60000)) askGame("load_timeline").then(function (t) { perf.timeline = t; if (perf.tab === "perf") renderPerf(); }).catch(function () {});
      if (perf.tab === "perf") renderPerf();
    }).catch(function (e) { if (perf.tab === "perf") $("perfhint").textContent = "metrics: " + e.message; });
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
    var g = m.game;
    if (!g || !g.present) add("info", "No game probe: the page has no window.__game, so scene/phase, engine timings and events are unknown. Add gamelab/probes (Godot autoload, Unity .jslib, or web) to get them.");
    else {
      var gm = g.metrics && !g.metrics.__error && !g.metrics.__pending ? g.metrics : null;
      if (gm && gameplay) {
        var budget = 16.7;
        if (typeof gm.physicsMs === "number" && gm.physicsMs > budget * 0.4) add(gm.physicsMs > budget * 0.7 ? "bad" : "warn", "Physics takes " + gm.physicsMs + " ms/frame (" + Math.round(gm.physicsMs / budget * 100) + "% of the 60 fps budget)" + (gm.physics3dPairs > 500 || gm.physics2dPairs > 500 ? " with " + (gm.physics3dPairs || gm.physics2dPairs) + " collision pairs — simplify colliders / use layers." : " — lower the physics tick rate or simplify colliders."));
        if (typeof gm.processMs === "number" && gm.processMs > budget * 0.5) add(gm.processMs > budget ? "bad" : "warn", "Script/process time " + gm.processMs + " ms/frame (" + Math.round(gm.processMs / budget * 100) + "% of budget) — profile to see which _process/Update is hot.");
        if (typeof gm.gcAllocKB === "number" && gm.gcAllocKB > 16) add("warn", "Allocating " + gm.gcAllocKB + " KB per frame on the managed heap — GC spikes ahead; pool objects, avoid LINQ/closures in Update.");
        if (typeof gm.orphanNodes === "number" && gm.orphanNodes > 0) add("warn", gm.orphanNodes + " orphan node" + (gm.orphanNodes > 1 ? "s" : "") + " (removed from the tree but not freed) — call queue_free(), this is a leak.");
        if (typeof gm.drawCalls === "number" && gm.drawCalls > 800) add("warn", "Engine reports " + gm.drawCalls + " draw calls/frame — batch, instance or merge meshes.");
        if (typeof gm.setPassCalls === "number" && gm.setPassCalls > 150) add("warn", gm.setPassCalls + " SetPass calls/frame — too many distinct materials/shader variants; share materials or use the SRP Batcher.");
        if (typeof gm.textureMB === "number" && gm.textureMB > 512) add("warn", "Texture memory " + gm.textureMB + " MB — mobile browsers cap WebGL memory; compress (KTX2/Basis) or downscale.");
        if (perf.nodeHist.length > 10) {
          var a0 = perf.nodeHist[0], a1 = perf.nodeHist[perf.nodeHist.length - 1], spanS = (a1.t - a0.t) / 1000;
          if (spanS > 30 && a1.n - a0.n > 200) add("warn", "Node/entity count grew " + a0.n + " → " + a1.n + " in " + Math.round(spanS) + " s without coming back — spawner without despawn?");
        }
      }
      if (g.state && g.state.__error) add("warn", "window.__game.state() threw: " + g.state.__error);
      if (gm === null && g.metrics && g.metrics.__error) add("warn", "window.__game.metrics() threw: " + g.metrics.__error);
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
    h += renderGame(m.game);
    var fs = findings(m);
    h += '<div class="sec" id="findings"><b>Findings</b><div>' + (fs.length ? '<ul>' + fs.map(function (x) { return '<li class="' + x.cls + '">' + esc(x.text) + '</li>'; }).join("") + '</ul>' : '<span class="muted">Collecting…</span>') + '</div></div>';
    if (perf.profile) h += renderProfile(perf.profile);
    else h += '<div class="sec"><b>Profile</b><div class="muted">Press ● Profile while playing to sample the main thread and list the hottest functions (Chromium; JS Self-Profiling API).' + (perf.profiling ? " Sampling…" : "") + '</div></div>';
    $("perfbody").innerHTML = h;
    $("perfhint").textContent = perf.profiling ? "profiling…" : "";
  }
  var BUDGET_KEYS = { processMs: 1, physicsMs: 1, renderMs: 1, scriptMs: 1, navigationMs: 1, frameMs: 1 };
  function fmtVal(v) {
    if (v == null) return "–";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    if (typeof v === "object") { var j = JSON.stringify(v); return j.length > 60 ? j.slice(0, 57) + "…" : j; }
    return String(v);
  }
  function renderGame(g) {
    if (!g || !g.present) return '<div class="sec"><b>Game</b><div class="muted">No probe (window.__game). Drop in <code>probes/godot/gamelab_probe.gd</code>, <code>probes/unity/GameLabProbe.cs</code> or <code>probes/web/gamelab-probe.js</code> to see scene/phase, engine timings and events here.</div></div>';
    var h = '<div class="sec"><b>Game</b><div>' + kv("engine", (g.engine || "?") + (g.version ? " " + g.version : "")) + (g.hasCommands ? kv("commands", "yes", "", "window.__game.command(name, args) is wired") : kv("commands", "none")) + '</div></div>';
    var st = g.state;
    if (st && typeof st === "object" && !st.__error && !st.__pending) {
      var keys = Object.keys(st);
      h += '<div class="sec"><b>State</b><div>' + (keys.length ? keys.slice(0, 24).map(function (k) { return kv(k, fmtVal(st[k]), "", typeof st[k] === "object" ? JSON.stringify(st[k]) : ""); }).join("") : '<span class="muted">state() returned {}</span>') + '</div></div>';
    } else if (st && st.__error) h += '<div class="sec"><b>State</b><div class="warn">state() threw: ' + esc(st.__error) + '</div></div>';
    var gm = g.metrics;
    if (gm && typeof gm === "object" && !gm.__error && !gm.__pending) {
      var parts = [], custom = null;
      Object.keys(gm).forEach(function (k) {
        if (k === "custom" && gm[k] && typeof gm[k] === "object") { custom = gm[k]; return; }
        var v = gm[k], cls = "";
        if (BUDGET_KEYS[k] && typeof v === "number") cls = v > 16.7 * 0.7 ? "bad" : v > 16.7 * 0.4 ? "warn" : "";
        if (k === "orphanNodes" && v > 0) cls = "warn";
        if (k === "gcAllocKB" && v > 16) cls = "warn";
        parts.push(kv(k, fmtVal(v) + (BUDGET_KEYS[k] ? " ms" : ""), cls));
      });
      h += '<div class="sec"><b>Engine</b><div>' + parts.join("") + (custom ? '<br><i class="muted">custom</i> ' + Object.keys(custom).map(function (k) { return kv(k, fmtVal(custom[k])); }).join("") : "") + '</div></div>';
    }
    if (perf.events.length) h += '<div class="sec"><b>Events</b><div>' + perf.events.slice(-12).map(function (e) { return kv("@" + secs(e.at), e.name + (e.data != null ? " " + fmtVal(e.data) : ""), "", e.data != null ? JSON.stringify(e.data) : ""); }).join("") + '</div></div>';
    return h;
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
    perf.profiling = true; $("prof").classList.add("busy"); $("prof").lastChild.textContent = (ms / 1000) + " s\u2026"; $("prof").disabled = true; renderPerf();
    askGame("profile", { durationMs: ms }, ms + 10000).then(function (p) { perf.profile = p; }).catch(function (e) { perf.profile = { supported: false, reason: "Profile failed: " + e.message }; })
      .then(function () { perf.profiling = false; $("prof").classList.remove("busy"); $("prof").lastChild.textContent = "Profile"; $("prof").disabled = false; renderPerf(); });
  }

  // ---- timeline graph ----
  var LANES = [
    { key: "fps", label: "FPS", color: "#3fcf8e", refs: [60, 30], floor: 60, zero: true, dec: 0, tone: function (v) { return v >= 55 ? "" : v >= 30 ? "warn" : "bad"; } },
    { key: "worstMs", label: "Frame (worst)", unit: " ms", color: "#f2b84b", refs: [16.7, 33.3], floor: 33.3, cap: 120, zero: true, dec: 1, tone: function (v) { return v > 50 ? "bad" : v > 33.3 ? "warn" : ""; } },
    { key: "drawCalls", label: "Draw calls", color: "#7aa2ff", floor: 8, zero: true, dec: 0 },
    { key: "heapMB", label: "JS heap", unit: " MB", color: "#c58af9", zero: false, dec: 0, opt: true },
    { key: "eng.processMs", label: "Engine process", unit: " ms", color: "#ff8c69", refs: [16.7], floor: 16.7, cap: 120, zero: true, dec: 1, opt: true, tone: function (v) { return v > 16.7 ? "bad" : v > 8 ? "warn" : ""; } },
    { key: "eng.physicsMs", label: "Engine physics", unit: " ms", color: "#ffb36b", refs: [16.7], floor: 4, cap: 120, zero: true, dec: 2, opt: true },
    { key: "eng.renderMs", label: "Engine render", unit: " ms", color: "#ff9fb0", refs: [16.7], floor: 16.7, cap: 120, zero: true, dec: 1, opt: true },
    { key: "eng.scriptMs", label: "Engine script", unit: " ms", color: "#e0b86b", refs: [16.7], floor: 16.7, cap: 120, zero: true, dec: 1, opt: true },
    { key: "eng.entities", label: "Nodes", color: "#6bd6e0", zero: false, dec: 0, opt: true },
  ];
  var TONE = { "": "#d7dae0", warn: "#f2b84b", bad: "#ff6b6b" };
  var G = { win: 60000, hover: null, off: {}, raf: 0, ro: null };
  try { var offSaved = JSON.parse(localStorage.getItem("gp.graphOff") || "{}"); if (offSaved && typeof offSaved === "object") G.off = offSaved; } catch (e) {}
  function engineSample(gm, ent) {
    var o = {};
    ["processMs", "physicsMs", "renderMs", "scriptMs"].forEach(function (k) { if (typeof gm[k] === "number") o[k] = gm[k]; });
    if (typeof ent === "number") o.entities = ent;
    return o;
  }
  function addMark(kind, name, t) { marks.push({ kind: kind, name: String(name || kind).slice(0, 40), t: t || Date.now() }); if (marks.length > 300) marks.shift(); if (perf.tab === "graph") scheduleGraph(); }
  function laneVal(smp, key) {
    if (key.indexOf("eng.") === 0) return smp.eng ? smp.eng[key.slice(4)] : null;
    return smp[key];
  }
  function laneHasData(l) { for (var i = hist.length - 1; i >= 0 && i >= hist.length - 600; i--) { var v = laneVal(hist[i], l.key); if (typeof v === "number") return true; } return false; }
  function activeLanes() { return LANES.filter(function (l) { return !G.off[l.key] && (!l.opt || laneHasData(l)); }); }
  function fmtLane(l, v) { return v == null ? "–" : (l.dec ? v.toFixed(l.dec) : Math.round(v)) + (l.unit || ""); }
  function renderLaneChips() {
    var el = $("glanes"), h = "";
    LANES.forEach(function (l) {
      if (l.opt && !laneHasData(l)) return;
      var on = !G.off[l.key];
      h += '<button type="button" class="tog" data-lane="' + l.key + '" aria-pressed="' + on + '" title="' + (on ? "Hide" : "Show") + ' ' + esc(l.label) + '"><i' + (on ? ' style="background:' + l.color + '"' : "") + '></i>' + esc(l.label) + '</button>';
    });
    if (el.innerHTML !== h) el.innerHTML = h;
  }
  $("glanes").addEventListener("click", function (e) {
    var b = e.target.closest("[data-lane]"); if (!b) return;
    var k = b.dataset.lane; if (G.off[k]) delete G.off[k]; else G.off[k] = 1;
    try { localStorage.setItem("gp.graphOff", JSON.stringify(G.off)); } catch (err) {}
    renderLaneChips(); scheduleGraph();
  });
  $("gwin").onchange = function () { G.win = Number($("gwin").value); scheduleGraph(); };
  $("gcsv").onclick = function () {
    var cols = ["time", "fps", "worstMs", "drawCalls", "heapMB", "processMs", "physicsMs", "renderMs", "scriptMs", "entities"];
    var lines = [cols.join(",")];
    hist.forEach(function (s) {
      var e = s.eng || {};
      lines.push([new Date(s.t).toISOString(), s.fps, s.worstMs, s.drawCalls, s.heapMB == null ? "" : s.heapMB, e.processMs == null ? "" : e.processMs, e.physicsMs == null ? "" : e.physicsMs, e.renderMs == null ? "" : e.renderMs, e.scriptMs == null ? "" : e.scriptMs, e.entities == null ? "" : e.entities].join(","));
    });
    var blob = new Blob([lines.join(String.fromCharCode(10))], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "gamelab-timeline-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".csv"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  };
  function history(o) {
    o = o || {}; var win = o.windowMs || 60000, step = Math.max(1, o.step || 1), now = Date.now();
    var src = hist.filter(function (s) { return !win || now - s.t <= win; });
    var out = [];
    for (var i = src.length - 1; i >= 0; i -= step) { var s = src[i]; out.unshift({ t: new Date(s.t).toISOString().slice(11, 23), ago: Math.round((now - s.t) / 100) / 10, fps: s.fps, worstMs: s.worstMs, drawCalls: s.drawCalls, heapMB: s.heapMB, engine: s.eng }); }
    var mk = marks.filter(function (m) { return !win || now - m.t <= win; }).map(function (m) { return { t: new Date(m.t).toISOString().slice(11, 23), ago: Math.round((now - m.t) / 100) / 10, kind: m.kind, name: m.name }; });
    return { samples: out, marks: mk.slice(-60), intervalMs: 500 * step, windowMs: win, total: hist.length };
  }
  function scheduleGraph() { if (G.raf) return; G.raf = requestAnimationFrame(function () { G.raf = 0; drawGraph(); }); }
  function drawGraph() {
    var box = $("graph"), c = $("gc"); if (box.clientWidth === 0) return;
    var lanes = activeLanes(), LANE_MIN = 44, AXIS = 18, GUT = 46, MK = 14;
    var W = box.clientWidth, H = Math.max(box.clientHeight, lanes.length * LANE_MIN + AXIS + MK), dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.height = H + "px"; }
    var ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    $("gempty").style.display = hist.length < 3 ? "flex" : "none";
    if (hist.length < 3 || !lanes.length) { if (hist.length >= 3) { ctx.fillStyle = "#8b93a3"; ctx.font = "11.5px " + MONO; ctx.textAlign = "center"; ctx.fillText("All series hidden", W / 2, H / 2); } return; }
    var now = Date.now(), t1 = now, t0 = G.win ? now - G.win : Math.min(hist[0].t, now - 10000);
    var PW = W - GUT, laneH = (H - AXIS - MK) / lanes.length;
    var X = function (t) { return (t - t0) / (t1 - t0) * PW; };
    var vis = [], i0 = 0; for (var i = 0; i < hist.length; i++) if (hist[i].t >= t0 - 1000) { i0 = i; break; }
    vis = hist.slice(i0);
    // hover sample
    var hs = null;
    if (G.hover != null) { var ht = t0 + (G.hover / PW) * (t1 - t0), best = 1e12; for (var j = 0; j < vis.length; j++) { var d = Math.abs(vis[j].t - ht); if (d < best) { best = d; hs = vis[j]; } } if (hs && Math.abs(X(hs.t) - G.hover) > 28) hs = null; }
    ctx.font = "10px " + MONO; ctx.textBaseline = "middle";
    lanes.forEach(function (l, li) {
      var top = MK + li * laneH, bot = top + laneH, labelYs = [];
      // range
      var mn = Infinity, mx = -Infinity;
      for (var k = 0; k < vis.length; k++) { var v = laneVal(vis[k], l.key); if (typeof v === "number") { if (v < mn) mn = v; if (v > mx) mx = v; } }
      if (mn === Infinity) { mn = 0; mx = l.floor || 1; }
      if (l.zero) mn = 0; else { var pad = Math.max((mx - mn) * 0.15, mx === mn ? Math.abs(mx) * 0.05 || 1 : 0); mn -= pad; mx += pad; }
      if (l.floor && mx < l.floor) mx = l.floor;
      if (l.cap && mx > l.cap) mx = l.cap;
      if (mx <= mn) mx = mn + 1;
      var Y = function (v) { return bot - 6 - Math.max(0, Math.min(1, (v - mn) / (mx - mn))) * (laneH - 24); };
      // separator
      ctx.strokeStyle = "#1a1e27"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, Math.round(bot) + 0.5); ctx.lineTo(W, Math.round(bot) + 0.5); ctx.stroke();
      // reference lines
      (l.refs || []).forEach(function (r) {
        if (r < mn || r > mx) return;
        var y = Math.round(Y(r)) + 0.5; ctx.strokeStyle = "#2a3140"; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PW, y); ctx.stroke(); ctx.setLineDash([]);
        gutter(String(r), y);
      });
      // axis extremes in gutter (skip labels that would collide)
      function gutter(txt, y) { for (var q = 0; q < labelYs.length; q++) if (Math.abs(labelYs[q] - y) < 10) return; labelYs.push(y); ctx.fillStyle = "#5b6371"; ctx.textAlign = "left"; ctx.fillText(txt, PW + 6, y); }
      gutter(fmtLane(l, mx).replace(/ .*/, ""), top + 10);
      if (!l.zero) gutter(fmtLane(l, mn).replace(/ .*/, ""), bot - 7);
      // series
      var path = false, lastX = null, lastY = null;
      ctx.beginPath();
      for (var k2 = 0; k2 < vis.length; k2++) {
        var s = vis[k2], v2 = laneVal(s, l.key);
        if (typeof v2 !== "number") { path = false; continue; }
        var x = X(s.t), y = Y(v2);
        if (!path) { ctx.moveTo(x, y); path = true; } else ctx.lineTo(x, y);
        lastX = x; lastY = y;
      }
      ctx.strokeStyle = l.color; ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.stroke();
      // area fill (light) — same path, closed to the lane floor
      ctx.save(); ctx.globalAlpha = 0.09; ctx.fillStyle = l.color; ctx.beginPath(); path = false; var startX = null;
      for (var k3 = 0; k3 < vis.length; k3++) {
        var s3 = vis[k3], v3 = laneVal(s3, l.key);
        if (typeof v3 !== "number") { if (path) { ctx.lineTo(lastSegX, bot - 6); ctx.lineTo(startX, bot - 6); ctx.closePath(); } path = false; continue; }
        var x3 = X(s3.t), y3 = Y(v3);
        if (!path) { startX = x3; ctx.moveTo(x3, bot - 6); ctx.lineTo(x3, y3); path = true; } else ctx.lineTo(x3, y3);
        var lastSegX = x3;
      }
      if (path) { ctx.lineTo(lastSegX, bot - 6); ctx.lineTo(startX, bot - 6); ctx.closePath(); }
      ctx.fill(); ctx.restore();
      // live dot
      if (lastX != null && !hs) { ctx.fillStyle = l.color; ctx.beginPath(); ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2); ctx.fill(); }
      // legend: label + value (hover or latest)
      var cur = hs ? laneVal(hs, l.key) : (vis.length ? laneVal(vis[vis.length - 1], l.key) : null);
      if (hs && typeof cur === "number") { ctx.fillStyle = l.color; ctx.beginPath(); ctx.arc(X(hs.t), Y(cur), 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.textAlign = "left"; ctx.fillStyle = l.color; ctx.font = "600 10.5px " + MONO; ctx.fillText(l.label, 8, top + 11);
      var lw = ctx.measureText(l.label).width;
      ctx.font = "11px " + MONO; ctx.fillStyle = TONE[l.tone && typeof cur === "number" ? l.tone(cur) : ""]; ctx.fillText(fmtLane(l, cur), 8 + lw + 10, top + 11);
    });
    // marks: events / errors / reloads
    ctx.font = "10px " + MONO; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    var lastLabelEnd = -1e9, gh = MK + lanes.length * laneH;
    marks.forEach(function (m) {
      if (m.t < t0 || m.t > t1) return;
      var x = Math.round(X(m.t)) + 0.5, col = m.kind === "error" ? "#ff6b6b" : m.kind === "sys" ? "#4fa3ff" : "#3fcf8e";
      ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, MK - 3); ctx.lineTo(x, gh); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = col; ctx.fillRect(x - 1.5, MK - 5, 3, 3);
      var label = m.kind === "error" ? "error" : m.name, tw = ctx.measureText(label).width;
      if (x + 4 + tw < PW && x > lastLabelEnd + 6) { ctx.fillText(label, x + 4, 7); lastLabelEnd = x + 4 + tw; }
    });
    // time axis
    var span = t1 - t0, stepMs = span <= 30000 ? 5000 : span <= 60000 ? 10000 : span <= 300000 ? 60000 : span <= 900000 ? 120000 : 300000;
    ctx.fillStyle = "#5b6371"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
    for (var back = stepMs; back < span; back += stepMs) {
      var tx = X(t1 - back); if (tx < 20) break;
      ctx.strokeStyle = "#1a1e27"; ctx.beginPath(); ctx.moveTo(Math.round(tx) + 0.5, gh); ctx.lineTo(Math.round(tx) + 0.5, gh + 4); ctx.stroke();
      ctx.fillText("-" + (back >= 60000 ? (back / 60000) + " min" : (back / 1000) + " s"), tx, gh + 10);
    }
    ctx.textAlign = "right"; ctx.fillStyle = hs ? "#5b6371" : "#8b93a3"; ctx.fillText("now", PW - 2, gh + 10);
    // crosshair
    if (hs) {
      var hx = Math.round(X(hs.t)) + 0.5;
      ctx.strokeStyle = "#8b93a3"; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(hx, MK); ctx.lineTo(hx, gh); ctx.stroke(); ctx.globalAlpha = 1;
      var ago = (now - hs.t) / 1000, lab = "-" + (ago >= 60 ? Math.floor(ago / 60) + "m " + Math.round(ago % 60) + "s" : ago.toFixed(1) + " s");
      ctx.font = "600 10px " + MONO; var tw2 = ctx.measureText(lab).width; ctx.textAlign = "center";
      ctx.fillStyle = "#171a21"; ctx.fillRect(Math.min(Math.max(hx - tw2 / 2 - 4, 0), PW - tw2 - 8), gh + 2, tw2 + 8, 14);
      ctx.fillStyle = "#d7dae0"; ctx.fillText(lab, Math.min(Math.max(hx, tw2 / 2 + 4), PW - tw2 / 2 - 4), gh + 10);
    }
  }
  var MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
  $("gc").addEventListener("pointermove", function (e) { var r = $("gc").getBoundingClientRect(); G.hover = e.clientX - r.left; scheduleGraph(); });
  $("gc").addEventListener("pointerleave", function () { G.hover = null; scheduleGraph(); });
  if (window.ResizeObserver) { G.ro = new ResizeObserver(function () { if (perf.tab === "graph") scheduleGraph(); }); G.ro.observe($("graph")); }
  else window.addEventListener("resize", function () { if (perf.tab === "graph") scheduleGraph(); });
  setInterval(function () { if (perf.tab === "graph" && !document.hidden && !connected) scheduleGraph(); }, 1000);

  // ---- messages from the game hook ----
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.__gp !== 1 || e.source !== game.contentWindow) return;
    if (m.type === "hello") {
      env = m.env; connected = true; loadedAt = Date.now(); fpsHist = []; fpsWindow = [];
      $("conn").className = "dot on"; renderBadges(); drawSpark(); perfReset(); lastEngine = null;
      if (hist.length) addMark("sys", "reload");
      addLog({ level: "sys", text: "— page loaded " + new Date().toLocaleTimeString() + (env.crossOriginIsolated ? " · isolated" : "") + " —", t: Date.now() });
    } else if (m.type === "console") { addLog({ level: m.level, text: m.text, stack: m.stack, t: m.t }); if (m.level === "error") addMark("error", m.text, m.t); }
    else if (m.type === "fps") onFps(m);
    else if (m.type === "game_event") { addMark("event", m.name); perf.events.push(m); if (perf.events.length > 30) perf.events.shift(); addLog({ level: "event", name: m.name, text: m.data != null ? JSON.stringify(m.data) : "", t: Date.now() }); if (perf.tab === "perf") renderPerf(); }
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
            if (e.level === "event") { if (lvl === "error" || lvl === "warn") return false; return !q || (e.name + " " + e.text).toLowerCase().indexOf(q) >= 0; }
            if (lvl === "error" && e.level !== "error") return false;
            if (lvl === "warn" && e.level !== "warn" && e.level !== "error") return false;
            if (q && e.text.toLowerCase().indexOf(q) < 0) return false;
            return true;
          });
          var out = src.slice(-limit).map(function (e) { return { t: new Date(e.t).toISOString().slice(11, 23), level: e.level, text: e.level === "event" ? e.name + (e.text ? " " + e.text : "") : e.text, count: e.count > 1 ? e.count : undefined, stack: e.stack ? String(e.stack).split("\\n").slice(0, 6).join("\\n") : undefined }; });
          var res = { entries: out, returned: out.length, matched: src.length, totals: counts };
          if (cmd.clear) clearLogs();
          return sendResult(cmd.id, true, res);
        }
        case "clear_logs": clearLogs(); return sendResult(cmd.id, true, { cleared: true });
        case "get_stats": return sendResult(cmd.id, true, stats());
        case "get_history": return sendResult(cmd.id, true, history(cmd));
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
  applyViewport(); loadDevices();
  fetch("/__gp/api/info").then(function (r) { return r.json(); }).then(function (j) { if (j && j.ui) setState(j.ui); }).catch(function () {});
})();
</script>
</body>
</html>`;
}
