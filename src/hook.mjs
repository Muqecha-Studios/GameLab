// Script injected into the game's HTML. Runs inside the game iframe and talks
// to the shell page via postMessage: console/error capture, FPS + heap
// sampling, environment probe, and a small command channel (eval,
// screenshot, synthetic input) used by the agent actions.

export const HOOK_JS = String.raw`(() => {
  if (window.__gamePreviewHook) return;
  window.__gamePreviewHook = true;

  const post = (msg) => { try { parent.postMessage(Object.assign({ __gp: 1 }, msg), "*"); } catch (_) {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- device emulation (set by the server as window.__gpEmu) --------------
  // Runs before any game script: fakes what a page can know about its device
  // (DPR, UA, touch, cores, memory, screen). CPU/network need the lab.
  const emu = window.__gpEmu && typeof window.__gpEmu === "object" ? window.__gpEmu : null;
  const applied = [];
  if (emu) {
    const def = (obj, key, value) => { try { Object.defineProperty(obj, key, { get: () => value, configurable: true }); return true; } catch (_) { return false; } };
    if (emu.dpr && emu.dpr !== window.devicePixelRatio && def(window, "devicePixelRatio", emu.dpr)) applied.push("dpr " + emu.dpr);
    if (emu.ua && def(Navigator.prototype, "userAgent", emu.ua)) {
      applied.push("ua");
      const plat = /iPhone|iPad/.test(emu.ua) ? (/iPad/.test(emu.ua) ? "iPad" : "iPhone") : /Android/.test(emu.ua) ? "Linux armv8l" : /CrOS|X11/.test(emu.ua) ? "Linux x86_64" : null;
      if (plat) def(Navigator.prototype, "platform", plat);
      if (emu.mobile) def(Navigator.prototype, "userAgentData", undefined);
    }
    if (emu.touch) { def(Navigator.prototype, "maxTouchPoints", 5); if (!("ontouchstart" in window)) { try { window.ontouchstart = null; } catch (_) {} } applied.push("touch"); }
    if (emu.cores && def(Navigator.prototype, "hardwareConcurrency", emu.cores)) applied.push(emu.cores + " cores");
    if (emu.memoryGB && "deviceMemory" in Navigator.prototype) def(Navigator.prototype, "deviceMemory", Math.min(8, Math.max(0.25, Math.pow(2, Math.round(Math.log2(emu.memoryGB))))));
    if (emu.width && emu.height && typeof Screen !== "undefined") { def(Screen.prototype, "width", emu.width); def(Screen.prototype, "height", emu.height); def(Screen.prototype, "availWidth", emu.width); def(Screen.prototype, "availHeight", emu.height); }
  }

  // ---- serialization -----------------------------------------------------
  function serialize(v, depth, seen) {
    depth = depth || 0; seen = seen || new WeakSet();
    if (v === null || v === undefined) return v === null ? null : "undefined";
    const t = typeof v;
    if (t === "string" || t === "boolean") return v;
    if (t === "number") return Number.isFinite(v) ? v : String(v);
    if (t === "bigint") return v.toString() + "n";
    if (t === "function") return "[Function " + (v.name || "anonymous") + "]";
    if (t === "symbol") return v.toString();
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
    if (typeof Node !== "undefined" && v instanceof Node) return "<" + (v.nodeName || "").toLowerCase() + (v.id ? "#" + v.id : "") + ">";
    if (ArrayBuffer.isView(v)) return "[" + v.constructor.name + "(" + v.length + ")]";
    if (v instanceof ArrayBuffer) return "[ArrayBuffer(" + v.byteLength + ")]";
    if (v instanceof Promise) return "[Promise]";
    if (v instanceof Map) v = Object.fromEntries([...v.entries()].slice(0, 50));
    else if (v instanceof Set) v = [...v].slice(0, 100);
    if (seen.has(v)) return "[Circular]";
    if (depth > 4) return Array.isArray(v) ? "[Array(" + v.length + ")]" : "[" + ((v.constructor && v.constructor.name) || "Object") + "]";
    seen.add(v);
    if (Array.isArray(v)) {
      const out = v.slice(0, 100).map((x) => serialize(x, depth + 1, seen));
      if (v.length > 100) out.push("… +" + (v.length - 100) + " more");
      return out;
    }
    const out = {}; let n = 0;
    for (const k in v) {
      if (n++ >= 50) { out["…"] = "+" + (Object.keys(v).length - 50) + " keys"; break; }
      try { out[k] = serialize(v[k], depth + 1, seen); } catch (e) { out[k] = "[unreadable]"; }
    }
    return out;
  }
  function fmt(v) {
    if (typeof v === "string") return v;
    try { return JSON.stringify(serialize(v)); } catch (_) { return String(v); }
  }

  // ---- console + errors --------------------------------------------------
  for (const level of ["log", "info", "warn", "error", "debug", "trace"]) {
    const orig = typeof console[level] === "function" ? console[level].bind(console) : null;
    console[level] = function () {
      const args = Array.prototype.slice.call(arguments);
      post({ type: "console", level: level === "trace" ? "debug" : level, text: args.map(fmt).join(" "), t: Date.now() });
      if (orig) orig.apply(console, args);
    };
  }
  window.addEventListener("error", (e) => {
    const where = e.filename ? " @ " + e.filename.replace(location.origin, "") + ":" + e.lineno + ":" + e.colno : "";
    post({ type: "console", level: "error", text: (e.message || "Error") + where, stack: e.error && e.error.stack, t: Date.now() });
  });
  window.addEventListener("unhandledrejection", (e) => {
    post({ type: "console", level: "error", text: "Unhandled rejection: " + fmt(e.reason), stack: e.reason && e.reason.stack, t: Date.now() });
  });

  // ---- activity ring (what happened when) --------------------------------
  // Used to attribute hitches/long tasks: shader compiles, big uploads, wasm
  // memory growth, GC (heap drop), asset fetches finishing mid-game.
  const ACT_MAX = 600;
  const activity = [];              // { t, kind, info }
  function act(kind, info) { activity.push({ t: performance.now(), kind: kind, info: info }); if (activity.length > ACT_MAX) activity.shift(); }

  // ---- WebGL instrumentation ---------------------------------------------
  // Counters are cumulative; the frame sampler diffs them per rAF tick.
  const gl = { draws: 0, instances: 0, texUploads: 0, texUploadBytes: 0, shaderCompiles: 0, programLinks: 0, bufferUploads: 0, bufferUploadBytes: 0, contextLost: 0, firstDrawAt: null,
    programSwitches: 0, fboBinds: 0, texBinds: 0, stateChanges: 0, uniformCalls: 0, readbacks: 0,
    texturesLive: 0, buffersLive: 0, programsLive: 0, framebuffersLive: 0, textureBytes: 0, bufferBytes: 0, renderbufferBytes: 0 };
  const glContexts = new Set();
  const texBytes = new WeakMap();   // WebGLTexture -> { [levelKey]: bytes, mip: bool }
  const bufBytes = new WeakMap();   // WebGLBuffer  -> bytes
  const rbBytes = new WeakMap();    // WebGLRenderbuffer -> bytes
  function wrap(proto, name, fn) {
    if (!proto || typeof proto[name] !== "function") return;
    const orig = proto[name];
    proto[name] = function () { try { fn.apply(this, arguments); } catch (_) {} return orig.apply(this, arguments); };
  }
  function markDraw(count) { gl.draws++; gl.instances += count || 1; if (gl.firstDrawAt === null) gl.firstDrawAt = performance.now(); }
  function st(ctx) { let o = ctx.__gpst; if (!o) { o = ctx.__gpst = { unit: 0, tex: {}, buf: {}, rb: null, prog: null, fbo: null }; } return o; }
  // bytes per pixel for (format, type); good enough for a memory estimate
  function bpp(ctx, fmt, type) {
    if (type === ctx.FLOAT) return fmt === ctx.RGBA ? 16 : fmt === ctx.RGB ? 12 : 4;
    if (type === 0x8D61 /* HALF_FLOAT_OES */ || type === 0x140B /* HALF_FLOAT */) return fmt === ctx.RGBA ? 8 : fmt === ctx.RGB ? 6 : 2;
    if (type === ctx.UNSIGNED_SHORT_4_4_4_4 || type === ctx.UNSIGNED_SHORT_5_5_5_1 || type === ctx.UNSIGNED_SHORT_5_6_5) return 2;
    if (type === ctx.UNSIGNED_SHORT || type === 0x84FA /* UNSIGNED_INT_24_8 */ ) return fmt === ctx.RGBA ? 8 : 2;
    if (type === ctx.UNSIGNED_INT || type === 0x8C3B || type === 0x8C3E) return 4;
    if (fmt === ctx.RGBA || fmt === 0x8D99 /* RGBA_INTEGER */) return 4;
    if (fmt === ctx.RGB) return 3;
    if (fmt === ctx.LUMINANCE_ALPHA) return 2;
    return 1;
  }
  const CUBE_MIN = 0x8515, CUBE_MAX = 0x851A;
  function bindTarget(t) { return t >= CUBE_MIN && t <= CUBE_MAX ? 0x8513 /* TEXTURE_CUBE_MAP */ : t; }
  function boundTex(ctx, target) { const o = st(ctx); return (o.tex[o.unit] || {})[bindTarget(target)] || null; }
  function setTexBytes(ctx, target, level, bytes) {
    const tex = boundTex(ctx, target); if (!tex) return;
    let rec = texBytes.get(tex); if (!rec) { rec = { levels: {}, total: 0 }; texBytes.set(tex, rec); }
    const key = target + ":" + level, prev = rec.levels[key] || 0;
    rec.levels[key] = bytes; rec.total += bytes - prev; gl.textureBytes += bytes - prev;
  }
  function srcDims(src) { if (!src) return null; const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height; return w && h ? [w, h] : null; }
  function onTexImage(ctx, a) {
    // texImage2D(target, level, internalformat, width, height, border, format, type, pixels) | (target, level, internalformat, format, type, source)
    gl.texUploads++;
    let w, h, fmt, type;
    if (a.length >= 9 || (a.length >= 8 && typeof a[3] === "number" && typeof a[4] === "number")) { w = a[3]; h = a[4]; fmt = a[6]; type = a[7]; }
    else { const d = srcDims(a[a.length - 1]); if (!d) return; w = d[0]; h = d[1]; fmt = a[3]; type = a[4]; }
    const bytes = Math.round(w * h * bpp(ctx, fmt, type));
    gl.texUploadBytes += bytes; if (a[1] === 0) setTexBytes(ctx, a[0], 0, bytes);
    if (bytes > 262144 && gl.firstDrawAt !== null) act("texUpload", w + "x" + h + " " + Math.round(bytes / 1024) + " KB");
  }
  function onTexImage3D(ctx, a) {
    gl.texUploads++; if (a.length < 10) return;
    const bytes = Math.round(a[3] * a[4] * a[5] * bpp(ctx, a[7], a[8]));
    gl.texUploadBytes += bytes; if (a[1] === 0) setTexBytes(ctx, a[0], 0, bytes);
  }
  function onCompressed(ctx, a) {
    gl.texUploads++; const data = a[a.length - 1], bytes = data && data.byteLength ? data.byteLength : (typeof a[a.length - 1] === "number" ? a[a.length - 1] : 0);
    gl.texUploadBytes += bytes; if (a[1] === 0) setTexBytes(ctx, a[0], 0, bytes);
  }
  function onBufferData(ctx, a) {
    gl.bufferUploads++;
    const d = a[1], bytes = typeof d === "number" ? d : d && d.byteLength ? (a.length >= 5 && typeof a[4] === "number" ? a[4] * (d.BYTES_PER_ELEMENT || 1) : d.byteLength) : 0;
    gl.bufferUploadBytes += bytes;
    const buf = st(ctx).buf[a[0]]; if (buf) { const prev = bufBytes.get(buf) || 0; bufBytes.set(buf, bytes); gl.bufferBytes += bytes - prev; }
    if (bytes > 1048576 && gl.firstDrawAt !== null) act("bufferUpload", Math.round(bytes / 1024) + " KB");
  }
  for (const P of [typeof WebGLRenderingContext !== "undefined" ? WebGLRenderingContext.prototype : null, typeof WebGL2RenderingContext !== "undefined" ? WebGL2RenderingContext.prototype : null]) {
    if (!P) continue;
    wrap(P, "drawArrays", () => markDraw(1));
    wrap(P, "drawElements", () => markDraw(1));
    wrap(P, "drawArraysInstanced", (m, f, c, n) => markDraw(n));
    wrap(P, "drawElementsInstanced", (m, c, t, o, n) => markDraw(n));
    wrap(P, "drawRangeElements", () => markDraw(1));
    wrap(P, "texImage2D", function () { onTexImage(this, arguments); });
    wrap(P, "texSubImage2D", () => gl.texUploads++);
    wrap(P, "compressedTexImage2D", function () { onCompressed(this, arguments); });
    wrap(P, "texImage3D", function () { onTexImage3D(this, arguments); });
    wrap(P, "texStorage2D", function (t, levels, fmt, w, h) { const b = Math.round(w * h * 4 * (levels > 1 ? 1.34 : 1)); gl.texUploadBytes += b; setTexBytes(this, t, 0, b); });
    wrap(P, "generateMipmap", function (t) { const tex = boundTex(this, t); const rec = tex && texBytes.get(tex); if (rec && !rec.mip) { rec.mip = true; const extra = Math.round(rec.total * 0.34); rec.total += extra; gl.textureBytes += extra; } });
    wrap(P, "compileShader", () => { gl.shaderCompiles++; if (gl.firstDrawAt !== null) act("shaderCompile"); });
    wrap(P, "linkProgram", () => { gl.programLinks++; if (gl.firstDrawAt !== null) act("programLink"); });
    wrap(P, "bufferData", function () { onBufferData(this, arguments); });
    wrap(P, "bufferSubData", () => gl.bufferUploads++);
    wrap(P, "useProgram", function (p) { const o = st(this); if (p !== o.prog) { o.prog = p; gl.programSwitches++; } });
    wrap(P, "bindFramebuffer", function (t, f) { const o = st(this); if (f !== o.fbo) { o.fbo = f; gl.fboBinds++; } });
    wrap(P, "activeTexture", function (u) { st(this).unit = u - 0x84C0; });
    wrap(P, "bindTexture", function (t, tex) { const o = st(this); const slot = o.tex[o.unit] || (o.tex[o.unit] = {}); if (slot[t] !== tex) { slot[t] = tex; gl.texBinds++; } });
    wrap(P, "bindBuffer", function (t, b) { st(this).buf[t] = b; });
    wrap(P, "bindRenderbuffer", function (t, rb) { st(this).rb = rb; });
    wrap(P, "renderbufferStorage", function (t, fmt, w, h) { const rb = st(this).rb; if (!rb) return; const b = w * h * 4, prev = rbBytes.get(rb) || 0; rbBytes.set(rb, b); gl.renderbufferBytes += b - prev; });
    wrap(P, "renderbufferStorageMultisample", function (t, samples, fmt, w, h) { const rb = st(this).rb; if (!rb) return; const b = w * h * 4 * Math.max(1, samples), prev = rbBytes.get(rb) || 0; rbBytes.set(rb, b); gl.renderbufferBytes += b - prev; });
    for (const n of ["enable", "disable", "blendFunc", "blendFuncSeparate", "blendEquation", "depthFunc", "depthMask", "cullFace", "frontFace", "colorMask", "stencilFunc", "stencilOp", "viewport", "scissor"]) wrap(P, n, () => gl.stateChanges++);
    for (const n of ["uniform1f", "uniform1i", "uniform2f", "uniform3f", "uniform4f", "uniform1fv", "uniform2fv", "uniform3fv", "uniform4fv", "uniformMatrix3fv", "uniformMatrix4fv", "uniform1iv"]) wrap(P, n, () => gl.uniformCalls++);
    wrap(P, "readPixels", () => { gl.readbacks++; if (gl.firstDrawAt !== null) act("readPixels"); });
    wrap(P, "getError", () => {});
    wrap(P, "createTexture", () => gl.texturesLive++);
    wrap(P, "deleteTexture", (tex) => { if (!tex) return; gl.texturesLive--; const rec = texBytes.get(tex); if (rec) { gl.textureBytes -= rec.total; texBytes.delete(tex); } });
    wrap(P, "createBuffer", () => gl.buffersLive++);
    wrap(P, "deleteBuffer", (b) => { if (!b) return; gl.buffersLive--; const prev = bufBytes.get(b); if (prev) { gl.bufferBytes -= prev; bufBytes.delete(b); } });
    wrap(P, "createProgram", () => gl.programsLive++);
    wrap(P, "deleteProgram", (p) => { if (p) gl.programsLive--; });
    wrap(P, "createFramebuffer", () => gl.framebuffersLive++);
    wrap(P, "deleteFramebuffer", (f) => { if (f) gl.framebuffersLive--; });
    wrap(P, "deleteRenderbuffer", (rb) => { if (!rb) return; const prev = rbBytes.get(rb); if (prev) { gl.renderbufferBytes -= prev; rbBytes.delete(rb); } });
  }
  // ANGLE_instanced_arrays (WebGL1) draws go through the extension object.
  const getExtension = typeof WebGLRenderingContext !== "undefined" ? WebGLRenderingContext.prototype.getExtension : null;
  if (getExtension) {
    WebGLRenderingContext.prototype.getExtension = function (name) {
      const ext = getExtension.call(this, name);
      if (ext && name === "ANGLE_instanced_arrays" && !ext.__gp) {
        ext.__gp = true;
        wrap(ext, "drawArraysInstancedANGLE", (m, f, c, n) => markDraw(n));
        wrap(ext, "drawElementsInstancedANGLE", (m, c, t, o, n) => markDraw(n));
      }
      return ext;
    };
  }

  // ---- GPU frame time (EXT_disjoint_timer_query_webgl2; Chromium desktop) --
  // One TIME_ELAPSED query spans the commands issued between two of our rAF
  // ticks (we registered rAF first, so our tick runs before the game's).
  const gpu = { ext: null, ctx: null, pending: [], active: null, samples: [], unavailable: null, disjoint: 0 };
  function gpuSetup() {
    if (gpu.ext || gpu.unavailable) return;
    const ctx = [...glContexts].filter((c) => typeof WebGL2RenderingContext !== "undefined" && c instanceof WebGL2RenderingContext).sort((a, b) => b.canvas.width * b.canvas.height - a.canvas.width * a.canvas.height)[0];
    if (!ctx) { if (glContexts.size) gpu.unavailable = "needs WebGL2"; return; }
    let ext = null; try { ext = ctx.getExtension("EXT_disjoint_timer_query_webgl2"); } catch (_) {}
    if (!ext) { gpu.unavailable = "EXT_disjoint_timer_query_webgl2 not exposed by this browser/GPU"; return; }
    gpu.ext = ext; gpu.ctx = ctx;
  }
  function gpuTick() {
    const ctx = gpu.ctx, ext = gpu.ext; if (!ext || ctx.isContextLost()) return;
    try {
      if (gpu.active) { ctx.endQuery(ext.TIME_ELAPSED_EXT); gpu.pending.push(gpu.active); gpu.active = null; }
      // collect finished queries (oldest first)
      while (gpu.pending.length) {
        const q = gpu.pending[0];
        if (!ctx.getQueryParameter(q, ctx.QUERY_RESULT_AVAILABLE)) break;
        gpu.pending.shift();
        if (ctx.getParameter(ext.GPU_DISJOINT_EXT)) { gpu.disjoint++; ctx.deleteQuery(q); continue; }
        const ns = ctx.getQueryParameter(q, ctx.QUERY_RESULT); ctx.deleteQuery(q);
        gpu.samples.push(ns / 1e6); if (gpu.samples.length > 600) gpu.samples.shift();
        if (ns > 0) gpu.nonzero = true; else if (!gpu.nonzero && gpu.samples.length >= 120) { gpu.unavailable = "timer query reports 0 ns (this driver does not time GPU work)"; gpu.ext = null; gpu.samples.length = 0; for (const p of gpu.pending) ctx.deleteQuery(p); gpu.pending.length = 0; return; }
      }
      if (gpu.pending.length > 8) { ctx.deleteQuery(gpu.pending.shift()); }
      if (!document.hidden) { const q = ctx.createQuery(); ctx.beginQuery(ext.TIME_ELAPSED_EXT, q); gpu.active = q; }
    } catch (e) { gpu.unavailable = "timer query failed: " + (e && e.message || e); gpu.ext = null; gpu.active = null; }
  }

  // Keep the WebGL back buffer around so screenshots are not blank, and
  // remember contexts so we can simulate context loss.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (typeof type === "string" && type.indexOf("webgl") === 0) attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
    const ctx = getContext.call(this, type, attrs);
    if (ctx && typeof type === "string" && type.indexOf("webgl") === 0 && !glContexts.has(ctx) && !this.__gpProbe) {
      glContexts.add(ctx);
      this.addEventListener("webglcontextlost", () => { gl.contextLost++; gpu.ext = null; gpu.active = null; gpu.pending = []; post({ type: "console", level: "warn", text: "[game-preview] webglcontextlost", t: Date.now() }); });
      this.addEventListener("webglcontextrestored", () => { gpu.unavailable = null; post({ type: "console", level: "info", text: "[game-preview] webglcontextrestored", t: Date.now() }); });
    }
    return ctx;
  };
  function mainCanvas() { return [...glContexts].map((c) => c.canvas).filter((c) => c && c.isConnected).sort((a, b) => b.width * b.height - a.width * a.height)[0] || null; }
  function renderInfo() {
    const c = mainCanvas(); if (!c) return null;
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const cssW = Math.round(r.width), cssH = Math.round(r.height);
    const scale = cssW && cssH ? Math.round(Math.sqrt((c.width * c.height) / (cssW * dpr * cssH * dpr)) * 100) / 100 : null;
    return { width: c.width, height: c.height, cssWidth: cssW, cssHeight: cssH, dpr: dpr, scale: scale, megapixels: Math.round(c.width * c.height / 1e4) / 100, contexts: glContexts.size };
  }

  // ---- wasm memory, workers, audio, DOM ----------------------------------
  const wasm = { memories: new Set(), grows: 0 };
  try {
    const OrigMemory = WebAssembly.Memory;
    const Patched = function Memory(desc) { const m = new OrigMemory(desc); wasm.memories.add(m); return m; };
    Patched.prototype = OrigMemory.prototype; WebAssembly.Memory = Patched;
    const grow = OrigMemory.prototype.grow;
    OrigMemory.prototype.grow = function (pages) { wasm.memories.add(this); wasm.grows++; act("wasmGrow", "+" + Math.round(pages * 64 / 1024) + " MB"); return grow.call(this, pages); };
    const origInstantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = function () { const t0 = performance.now(); const r = origInstantiate.apply(this, arguments); Promise.resolve(r).then((res) => { wasm.compileMs = Math.round(performance.now() - t0); const inst = res && res.instance ? res.instance : res; const mem = inst && inst.exports && inst.exports.memory; if (mem instanceof OrigMemory) wasm.memories.add(mem); }).catch(() => {}); return r; };
    if (WebAssembly.instantiateStreaming) { const origIS = WebAssembly.instantiateStreaming; WebAssembly.instantiateStreaming = function () { const t0 = performance.now(); const r = origIS.apply(this, arguments); Promise.resolve(r).then((res) => { wasm.compileMs = Math.round(performance.now() - t0); const mem = res && res.instance && res.instance.exports && res.instance.exports.memory; if (mem instanceof OrigMemory) wasm.memories.add(mem); }).catch(() => {}); return r; }; }
  } catch (_) {}
  function wasmMB() { let b = 0; wasm.memories.forEach((m) => { try { b = Math.max(b, m.buffer.byteLength); } catch (_) {} }); return b ? Math.round(b / 1048576 * 10) / 10 : null; }
  const workers = { live: 0, created: 0 };
  try {
    const OrigWorker = window.Worker;
    const W = function Worker(url, opts) { const w = new OrigWorker(url, opts); workers.live++; workers.created++; const term = w.terminate.bind(w); w.terminate = function () { workers.live--; return term(); }; return w; };
    W.prototype = OrigWorker.prototype; window.Worker = W;
  } catch (_) {}
  const audioCtxs = new Set();
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    try {
      const Orig = window[name]; if (!Orig) continue;
      const A = function AudioContext(opts) { const c = new Orig(opts); audioCtxs.add(c); return c; };
      A.prototype = Orig.prototype; window[name] = A;
    } catch (_) {}
  }
  function audioInfo() {
    const list = [...audioCtxs];
    if (!list.length) return { contexts: 0 };
    const c = list[0];
    return { contexts: list.length, state: c.state, sampleRate: c.sampleRate, baseLatencyMs: c.baseLatency != null ? Math.round(c.baseLatency * 1000 * 10) / 10 : null, outputLatencyMs: c.outputLatency != null ? Math.round(c.outputLatency * 1000 * 10) / 10 : null, worklet: !!c.audioWorklet };
  }

  // ---- visibility simulation ---------------------------------------------
  let forcedHidden = null;
  try {
    const dHidden = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
    const dState = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    if (dHidden && dState) {
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return forcedHidden === null ? dHidden.get.call(this) : forcedHidden; } });
      Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return forcedHidden === null ? dState.get.call(this) : (forcedHidden ? "hidden" : "visible"); } });
    }
  } catch (_) {}

  // ---- environment probe -------------------------------------------------
  function glInfo() {
    try {
      const c = document.createElement("canvas"); c.__gpProbe = true;
      const gl2 = c.getContext("webgl2"); const gl = gl2 || c.getContext("webgl");
      if (!gl) return null;
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        api: gl2 ? "WebGL2" : "WebGL1",
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      };
    } catch (_) { return null; }
  }
  post({
    type: "hello",
    env: {
      url: location.href,
      crossOriginIsolated: !!self.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
      webgpu: !!navigator.gpu,
      webgl: glInfo(),
      devicePixelRatio: devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      userAgent: navigator.userAgent,
      touch: navigator.maxTouchPoints > 0,
      emulation: emu ? { id: emu.id, name: emu.name, applied: applied, labOnly: [emu.cpu > 1 ? "cpu \u00d7" + emu.cpu : null, emu.network && emu.network !== "none" && emu.network !== "wifi" ? emu.network : null].filter(Boolean) } : null,
    },
  });

  // ---- FPS / frame time / CPU+GPU time / hitches / input latency ----------
  const HITCH_MS = 50, HITCH_MAX = 300;
  const hitches = [];               // { at: ms since timeOrigin, dt, draws, cause }
  let firstFrameAt = null, frameIndex = 0;
  let frames = 0, windowStart = performance.now(), prev = windowStart, worst = 0;
  let lastDraws = gl.draws, windowDraws = 0, lastFrameDraws = 0;
  let lastProg = 0, lastTexB = 0, lastFbo = 0, lastState = 0, winProg = 0, winTexB = 0, winFbo = 0, winState = 0;
  const frameTimes = [];            // last 1200 frame dts for percentiles / lows
  const cpuTimes = [];              // main-thread time per frame (rAF start -> post-render task)
  let frameCount = 0, winCpu = 0, winCpuN = 0, winGpu = 0, winGpuN = 0, gpuSeen = 0;
  let lastHeapMB = null, gcCount = 0;
  // Main-thread frame time: a MessageChannel message posted during rAF is
  // delivered after all rAF callbacks and the frame's rendering steps.
  let tickStart = 0, cpuPending = false;
  const mc = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
  if (mc) mc.port1.onmessage = () => { cpuPending = false; const ms = performance.now() - tickStart; if (frameTimes.length) { cpuTimes.push(ms); if (cpuTimes.length > 1200) cpuTimes.shift(); } winCpu += ms; winCpuN++; };
  // Input latency: first rAF after an input event -> event.timeStamp
  const inputLat = [];              // ms, last 200
  let winInput = 0, winInputN = 0;  // input latency seen in the current fps window
  let pendingInputTs = null;
  for (const ev of ["pointerdown", "keydown", "touchstart", "mousedown"]) window.addEventListener(ev, (e) => { if (e.isTrusted !== false && pendingInputTs === null) pendingInputTs = e.timeStamp; }, { capture: true, passive: true });
  // Event Timing API (Chromium): processing duration of input events
  const evTiming = [];
  try { if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf("event") >= 0) new PerformanceObserver((l) => { for (const e of l.getEntries()) { evTiming.push(e.duration); if (evTiming.length > 200) evTiming.shift(); } }).observe({ type: "event", durationThreshold: 16 }); } catch (_) {}
  // Long tasks (Chromium): main-thread blocks > 50 ms, independent of rAF
  const longTasks = { count: 0, totalMs: 0, recent: [] };
  try { if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf("longtask") >= 0) new PerformanceObserver((l) => { for (const e of l.getEntries()) { longTasks.count++; longTasks.totalMs += e.duration; longTasks.recent.push({ at: Math.round(e.startTime), ms: Math.round(e.duration), cause: attribute(e.startTime, e.startTime + e.duration) }); if (longTasks.recent.length > 40) longTasks.recent.shift(); } }).observe({ type: "longtask", buffered: true }); } catch (_) {}
  // What happened in [t0, t1]? Used for hitch/long-task attribution.
  function attribute(t0, t1) {
    const hits = {}, res = [];
    for (let i = activity.length - 1; i >= 0; i--) { const a = activity[i]; if (a.t < t0 - 5) break; if (a.t <= t1 + 5) { hits[a.kind] = (hits[a.kind] || 0) + 1; if (a.info && !hits[a.kind + ":info"]) hits[a.kind + ":info"] = a.info; } }
    try { for (const r of performance.getEntriesByType("resource").slice(-60)) { const end = r.responseEnd || (r.startTime + r.duration); if (end >= t0 - 5 && end <= t1 + 5 && r.startTime > 2000) res.push(r.name.split("/").pop().split("?")[0]); } } catch (_) {}
    const parts = [];
    if (hits.shaderCompile || hits.programLink) parts.push("shader compile" + (hits.shaderCompile > 1 ? " x" + hits.shaderCompile : ""));
    if (hits.wasmGrow) parts.push("wasm memory grow " + (hits["wasmGrow:info"] || ""));
    if (hits.texUpload) parts.push("texture upload" + (hits.texUpload > 1 ? " x" + hits.texUpload : "") + (hits["texUpload:info"] ? " (" + hits["texUpload:info"] + ")" : ""));
    if (hits.bufferUpload) parts.push("buffer upload" + (hits["bufferUpload:info"] ? " (" + hits["bufferUpload:info"] + ")" : ""));
    if (hits.readPixels) parts.push("readPixels (GPU sync)");
    if (hits.gc) parts.push("GC");
    if (res.length) parts.push("asset loaded: " + res.slice(0, 3).join(", "));
    if (hits.gameEvent) parts.push("during event " + (hits["gameEvent:info"] || ""));
    if (hits.visibility) parts.push("tab hidden/visible");
    return parts.length ? parts.join(" + ") : "script (no upload/compile/GC seen)";
  }
  document.addEventListener("visibilitychange", () => act("visibility", document.visibilityState));
  function tick(now) {
    frames++; frameIndex++; tickStart = now;
    if (firstFrameAt === null) firstFrameAt = now;
    const dt = now - prev; prev = now;
    // Frame statistics start once the game is actually rendering (1 s after
    // the first WebGL draw, or 3 s after the first frame); hitches are always logged.
    const warm = gl.firstDrawAt !== null ? now - gl.firstDrawAt > 1000 : now - firstFrameAt > 3000;
    if (frameIndex > 1) {
      if (dt > worst) worst = dt;
      if (warm) { frameTimes.push(dt); if (frameTimes.length > 1200) frameTimes.shift(); frameCount++; }
      if (dt > HITCH_MS && !document.hidden) { hitches.push({ at: Math.round(now), dt: Math.round(dt * 10) / 10, draws: lastFrameDraws, cause: attribute(now - dt, now) }); if (hitches.length > HITCH_MAX) hitches.shift(); }
    }
    if (pendingInputTs !== null) { const lat = now - pendingInputTs; if (lat >= 0 && lat < 2000) { inputLat.push(Math.round(lat * 10) / 10); if (inputLat.length > 200) inputLat.shift(); winInput += lat; winInputN++; } pendingInputTs = null; }
    lastFrameDraws = gl.draws - lastDraws; lastDraws = gl.draws; windowDraws += lastFrameDraws;
    winProg += gl.programSwitches - lastProg; lastProg = gl.programSwitches;
    winTexB += gl.texBinds - lastTexB; lastTexB = gl.texBinds;
    winFbo += gl.fboBinds - lastFbo; lastFbo = gl.fboBinds;
    winState += gl.stateChanges - lastState; lastState = gl.stateChanges;
    if (glContexts.size && !gpu.ext && !gpu.unavailable) gpuSetup();
    if (gpu.ext) { const before = gpu.samples.length; gpuTick(); for (let i = before; i < gpu.samples.length; i++) { winGpu += gpu.samples[i]; winGpuN++; } }
    if (mc && !cpuPending) { cpuPending = true; mc.port2.postMessage(0); }
    if (now - windowStart >= 500) {
      const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      if (mem != null && lastHeapMB != null && lastHeapMB - mem >= 3) { gcCount++; act("gc", (lastHeapMB - mem) + " MB freed"); }
      lastHeapMB = mem;
      const n = frames || 1;
      post({ type: "fps", fps: Math.round((frames * 1000) / (now - windowStart)), worstMs: Math.round(worst * 10) / 10, heapMB: mem, drawCalls: Math.round(windowDraws / n), t: Date.now(),
        cpuMs: winCpuN ? Math.round(winCpu / winCpuN * 10) / 10 : null, gpuMs: winGpuN ? Math.round(winGpu / winGpuN * 10) / 10 : null,
        progSwitches: Math.round(winProg / n), texBinds: Math.round(winTexB / n), fboBinds: Math.round(winFbo / n), stateChanges: Math.round(winState / n),
        inputMs: winInputN ? Math.round(winInput / winInputN * 10) / 10 : null });
      winInput = 0; winInputN = 0;
      frames = 0; worst = 0; windowStart = now; windowDraws = 0; winProg = winTexB = winFbo = winState = 0; winCpu = winCpuN = winGpu = winGpuN = 0;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- game probe (window.__game — see probes/) ---------------------------
  const GAME_EVENTS_MAX = 200;
  const gameEvents = [];            // { name, data, at }
  let gameEventsTotal = 0;
  window.addEventListener("gamelab", (e) => {
    const d = e.detail || {};
    if (d.type && d.type !== "event") return;
    gameEvents.push({ name: String(d.name ?? "event"), data: d.data ?? null, at: Math.round(d.t ?? performance.now()) });
    act("gameEvent", String(d.name ?? "event"));
    gameEventsTotal++;
    if (gameEvents.length > GAME_EVENTS_MAX) gameEvents.shift();
    post({ type: "game_event", name: String(d.name ?? "event"), data: d.data ?? null, at: Math.round(d.t ?? performance.now()) });
  });
  const isThenable = (v) => v && typeof v.then === "function";
  const safeCallSync = (fn) => { try { if (typeof fn !== "function") return undefined; const v = fn(); return isThenable(v) ? { __pending: true } : v; } catch (e) { return { __error: String(e && e.message || e) }; } };
  const safeCall = async (fn) => { try { return typeof fn === "function" ? await fn() : undefined; } catch (e) { return { __error: String(e && e.message || e) }; } };
  const NO_PROBE = "No game probe: the page has no window.__game. See gamelab probes/ (Godot autoload, Unity .jslib, web) to expose state, engine timings, marks and events.";
  function gameSnapshotSync() {
    const g = window.__game;
    if (!g) return { present: false };
    return { present: true, engine: g.engine ?? null, version: g.version ?? null, state: safeCallSync(g.state), metrics: safeCallSync(g.metrics), hasCommands: typeof g.command === "function" };
  }
  async function gameSnapshot(withEvents) {
    const g = window.__game;
    if (!g) return { present: false, hint: NO_PROBE };
    const out = { present: true, engine: g.engine ?? null, version: g.version ?? null, state: await safeCall(g.state), metrics: await safeCall(g.metrics), hasCommands: typeof g.command === "function" };
    if (withEvents) out.events = { total: gameEventsTotal, recent: gameEvents.slice(-50) };
    return out;
  }
  async function gameCommand(name, args) {
    const g = window.__game;
    if (!g) throw new Error("No game probe (window.__game) on this page");
    if (typeof g.command !== "function") throw new Error("The game probe has no command handler");
    const r = await g.command(name, args ?? null);
    return { name, result: r === undefined ? null : r };
  }

  function percentile(arr, p) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  }
  function stdev(arr) { if (arr.length < 2) return null; const m = arr.reduce((a, b) => a + b, 0) / arr.length; return Math.round(Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length) * 10) / 10; }
  function lows(arr) {
    // "1% low" = mean fps of the slowest 1% of frames (the gaming benchmark convention)
    if (arr.length < 100) return { low1: null, low01: null };
    const s = arr.slice().sort((a, b) => b - a);
    const n1 = Math.max(1, Math.floor(s.length * 0.01)), n01 = Math.max(1, Math.floor(s.length * 0.001));
    const mean = (k) => s.slice(0, k).reduce((a, b) => a + b, 0) / k;
    return { low1: Math.round(1000 / mean(n1)), low01: arr.length >= 1000 ? Math.round(1000 / mean(n01)) : null };
  }
  function bound() {
    // Where is the frame budget going? Main-thread time (rAF start → after rendering
    // steps), GPU time (timer query) and the actual frame interval, all p50.
    const dt = percentile(frameTimes, 0.5), cpu = percentile(cpuTimes, 0.5), gpuP = gpu.samples.length >= 30 ? percentile(gpu.samples, 0.5) : null;
    if (dt == null || cpu == null || frameTimes.length < 120) return { kind: "unknown", why: "not enough samples yet" };
    const gpuTxt = gpuP != null ? ", GPU " + gpuP + " ms" : "";
    if (dt <= 17.5) {
      // Holding the display rate: the frame interval is set by vsync, so main-thread
      // time tells us the headroom, not the bottleneck.
      const head = Math.round((16.7 - Math.max(cpu, gpuP || 0)) * 10) / 10;
      return { kind: head < 4 ? "vsync-tight" : "vsync", headroomMs: head, why: "holding " + Math.round(1000 / dt) + " fps (main " + cpu + " ms" + gpuTxt + ", ~" + head + " ms headroom" + (head < 4 ? " — slower devices will drop frames" : "") + ")" };
    }
    if (cpu >= dt * 0.75) return { kind: "cpu", why: "main thread busy " + cpu + " ms of a " + dt + " ms frame" + gpuTxt };
    if (gpuP != null && gpuP >= dt * 0.75) return { kind: "gpu", why: "GPU " + gpuP + " ms of a " + dt + " ms frame (main " + cpu + " ms)" };
    if (gpuP == null && cpu < dt * 0.5) return { kind: "gpu?", why: "main thread only " + cpu + " ms of a " + dt + " ms frame and GPU time is unavailable here — likely GPU-bound, or a " + Math.round(1000 / dt) + " Hz display/throttled tab" };
    return { kind: "mixed", why: "frame " + dt + " ms, main " + cpu + " ms" + gpuTxt + " — neither side dominates; look at hitches and long tasks" };
  }
  function metrics() {
    const wasmRes = performance.getEntriesByType("resource").filter((r) => /\.wasm(\?|$)/.test(r.name));
    const lo = lows(frameTimes), med = percentile(frameTimes, 0.5);
    const dropped = med ? frameTimes.filter((d) => d > med * 1.5).length : 0;
    return {
      game: gameSnapshotSync(),
      frame: { lastDrawCalls: lastFrameDraws, p50Ms: med, p95Ms: percentile(frameTimes, 0.95), p99Ms: percentile(frameTimes, 0.99), maxMs: percentile(frameTimes, 1), samples: frameTimes.length,
        low1PctFps: lo.low1, low01PctFps: lo.low01, jitterMs: stdev(frameTimes), droppedPct: frameTimes.length ? Math.round(dropped / frameTimes.length * 1000) / 10 : null },
      cpu: { p50Ms: percentile(cpuTimes, 0.5), p95Ms: percentile(cpuTimes, 0.95), maxMs: percentile(cpuTimes, 1), samples: cpuTimes.length },
      gpu: gpu.ext || gpu.samples.length ? { p50Ms: percentile(gpu.samples, 0.5), p95Ms: percentile(gpu.samples, 0.95), maxMs: percentile(gpu.samples, 1), samples: gpu.samples.length, disjoint: gpu.disjoint } : { unavailable: gpu.unavailable || (glContexts.size ? "waiting for a WebGL2 context" : "no WebGL context yet") },
      bound: bound(),
      hitches: { count: hitches.length, thresholdMs: HITCH_MS, recent: hitches.slice(-20) },
      longTasks: window.PerformanceObserver && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf("longtask") >= 0 ? { count: longTasks.count, totalMs: Math.round(longTasks.totalMs), recent: longTasks.recent.slice(-12) } : { unavailable: "Long Tasks API not supported" },
      input: { samples: inputLat.length, lastMs: inputLat.length ? inputLat[inputLat.length - 1] : null, p50Ms: percentile(inputLat, 0.5), p95Ms: percentile(inputLat, 0.95), eventTimingP95Ms: evTiming.length ? percentile(evTiming, 0.95) : null },
      render: renderInfo(),
      webgl: { drawCallsTotal: gl.draws, instancesTotal: gl.instances, textureUploads: gl.texUploads, textureUploadMB: Math.round(gl.texUploadBytes / 1048576 * 10) / 10, shaderCompiles: gl.shaderCompiles, programLinks: gl.programLinks, bufferUploads: gl.bufferUploads, bufferUploadMB: Math.round(gl.bufferUploadBytes / 1048576 * 10) / 10, contextLostCount: gl.contextLost, contexts: glContexts.size,
        programSwitchesTotal: gl.programSwitches, fboBindsTotal: gl.fboBinds, textureBindsTotal: gl.texBinds, stateChangesTotal: gl.stateChanges, uniformCallsTotal: gl.uniformCalls, readbacks: gl.readbacks,
        live: { textures: gl.texturesLive, buffers: gl.buffersLive, programs: gl.programsLive, framebuffers: gl.framebuffersLive },
        estMemoryMB: { textures: Math.round(gl.textureBytes / 1048576 * 10) / 10, buffers: Math.round(gl.bufferBytes / 1048576 * 10) / 10, renderbuffers: Math.round(gl.renderbufferBytes / 1048576 * 10) / 10 } },
      memory: { heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, heapLimitMB: performance.memory ? Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null,
        wasmBytes: wasmRes.reduce((a, r) => a + (r.decodedBodySize || 0), 0) || null, wasmMemoryMB: wasmMB(), wasmGrows: wasm.grows, wasmCompileMs: wasm.compileMs || null, gcCount: gcCount, domNodes: document.getElementsByTagName("*").length },
      audio: audioInfo(),
      threads: { workers: workers.live, workersCreated: workers.created, sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined", crossOriginIsolated: !!self.crossOriginIsolated, cores: navigator.hardwareConcurrency || null },
      visibility: document.visibilityState,
      uptimeMs: Math.round(performance.now()),
      gameEvents: { total: gameEventsTotal, recent: gameEvents.slice(-10) },
    };
  }
  function loadTimeline() {
    const nav = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource").map((r) => ({
      name: r.name.replace(location.origin, ""), type: r.initiatorType, startMs: Math.round(r.startTime), durationMs: Math.round(r.duration),
      transferKB: Math.round((r.transferSize || 0) / 1024), decodedKB: Math.round((r.decodedBodySize || 0) / 1024),
    }));
    const byTime = res.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
    const bySize = res.slice().sort((a, b) => b.decodedKB - a.decodedKB).slice(0, 10);
    const marks = performance.getEntriesByType("mark").map((m) => ({ name: m.name, atMs: Math.round(m.startTime) }));
    return {
      navigation: nav ? { domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadEventMs: Math.round(nav.loadEventEnd), responseEndMs: Math.round(nav.responseEnd) } : null,
      firstFrameMs: firstFrameAt === null ? null : Math.round(firstFrameAt),
      firstWebglDrawMs: gl.firstDrawAt === null ? null : Math.round(gl.firstDrawAt),
      resources: { count: res.length, totalTransferKB: res.reduce((a, r) => a + r.transferKB, 0), totalDecodedKB: res.reduce((a, r) => a + r.decodedKB, 0), slowest: byTime, largest: bySize },
      userMarks: marks.slice(0, 50),
    };
  }
  window.__gp = {
    metrics: metrics,
    loadTimeline: loadTimeline,
    hitches: () => hitches.slice(),
    gameState: () => gameSnapshot(true),
    gameCommand: gameCommand,
    gameEvents: () => gameEvents.slice(),
    resetHitches: () => { hitches.length = 0; frameTimes.length = 0; cpuTimes.length = 0; gpu.samples.length = 0; inputLat.length = 0; longTasks.count = 0; longTasks.totalMs = 0; longTasks.recent.length = 0; },
    setVisibility: (hidden) => { forcedHidden = hidden === null ? null : !!hidden; document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event(forcedHidden ? "blur" : "focus")); return document.visibilityState; },
    loseContext: async (restoreAfterMs) => {
      const ctx = [...glContexts].sort((a, b) => b.canvas.width * b.canvas.height - a.canvas.width * a.canvas.height)[0];
      if (!ctx) throw new Error("No WebGL context to lose");
      const ext = ctx.getExtension("WEBGL_lose_context");
      if (!ext) throw new Error("WEBGL_lose_context extension unavailable");
      ext.loseContext();
      if (restoreAfterMs !== null && restoreAfterMs !== undefined) { await sleep(restoreAfterMs); ext.restoreContext(); }
      return { lost: true, restored: restoreAfterMs !== null && restoreAfterMs !== undefined, contextLostCount: gl.contextLost };
    },
    profile: profile,
  };

  // ---- JS sampling profiler (JS Self-Profiling API; Chromium, needs Document-Policy: js-profiling) ----
  let profiling = false;
  async function profile(durationMs) {
    durationMs = Math.max(500, Math.min(30000, Number(durationMs) || 5000));
    if (typeof Profiler !== "function") return { supported: false, reason: "JS Self-Profiling API unavailable in this browser engine (" + (/AppleWebKit\/605/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent) ? "WebKit" : /Firefox/.test(navigator.userAgent) ? "Firefox" : "not Chromium, or Document-Policy: js-profiling header missing") + "). Open the shell URL in Chrome/Edge, or profile in the lab (target: lab / lab_open)." };
    if (profiling) throw new Error("A profile is already running");
    profiling = true;
    try {
      const interval = 10; // ms; Chrome clamps to >= ~10 ms
      const prof = new Profiler({ sampleInterval: interval, maxBufferSize: Math.ceil(durationMs / interval) + 100 });
      const startDraws = gl.draws, startFrames = frameCount, t0 = performance.now();
      await sleep(durationMs);
      const trace = await prof.stop();
      const wall = performance.now() - t0;
      const { frames, stacks, samples, resources } = trace;
      const fn = new Map(); // key -> { name, url, line, col, self, total }
      const keyOf = (f) => f.name + "@" + (f.resourceId ?? "") + ":" + (f.line ?? "") + ":" + (f.column ?? "");
      const labelOf = (f) => f.name || (f.resourceId != null ? "(anonymous)" : "(program)");
      let idle = 0, gc = 0, counted = 0;
      const pairs = new Map(); // "parentKey|childKey" -> ms, to spot pass-through wrappers
      const prev = { t: samples[0]?.timestamp ?? t0 };
      for (const s of samples) {
        const dt = Math.max(0, s.timestamp - prev.t); prev.t = s.timestamp;
        if (s.stackId == null) { idle += dt; continue; }
        if (s.marker === "gc") gc += dt;
        counted += dt;
        const seen = new Set();
        let sid = s.stackId, top = true, childKey = null;
        while (sid != null) {
          const st = stacks[sid]; const f = frames[st.frameId]; const k = keyOf(f);
          let e = fn.get(k);
          if (!e) { e = { name: labelOf(f), url: f.resourceId != null ? resources[f.resourceId] : null, line: f.line ?? null, col: f.column ?? null, self: 0, total: 0, key: k }; fn.set(k, e); }
          if (top) e.self += dt;
          if (!seen.has(k)) { e.total += dt; seen.add(k); if (childKey) { const pk = k + "|" + childKey; pairs.set(pk, (pairs.get(pk) || 0) + dt); } }
          top = false; childKey = k; sid = st.parentId;
        }
      }
      const r1 = (n) => Math.round(n * 10) / 10;
      const pct = (n) => (counted ? Math.round((n / counted) * 1000) / 10 : 0);
      const maxChild = new Map();
      for (const [pk, ms] of pairs) { const parent = pk.slice(0, pk.indexOf("|")); if (ms > (maxChild.get(parent) || 0)) maxChild.set(parent, ms); }
      const list = [...fn.values()].map((e) => ({ name: e.name, url: e.url ? e.url.replace(location.origin, "") : null, line: e.line, col: e.col, selfMs: r1(e.self), selfPct: pct(e.self), totalMs: r1(e.total), totalPct: pct(e.total), _branch: e.total > 0 && (maxChild.get(e.key) || 0) < 0.9 * e.total }));
      const strip = (e) => { const { _branch, ...o } = e; return o; };
      const bySelf = list.slice().sort((a, b) => b.selfMs - a.selfMs).slice(0, 25).map(strip);
      // Subtrees: skip pass-through wrappers (one child holds >=90% of the total) so the list shows branch points, not the whole call chain.
      const byTotal = list.filter((e) => e._branch).sort((a, b) => b.totalMs - a.totalMs).slice(0, 15).map(strip);
      const byFile = new Map();
      for (const e of list) { const k = e.url || "(native/program)"; byFile.set(k, (byFile.get(k) || 0) + e.selfMs); }
      return {
        supported: true, durationMs: Math.round(wall), sampleIntervalMs: interval, samples: samples.length,
        busyMs: r1(counted), idleMs: r1(idle), busyPct: wall ? Math.round((counted / wall) * 1000) / 10 : 0, gcMs: r1(gc),
        framesRendered: frameCount - startFrames, drawCalls: gl.draws - startDraws,
        hotFunctions: bySelf, heaviestSubtrees: byTotal,
        byFile: [...byFile.entries()].map(([url, ms]) => ({ url: url.replace(location.origin, ""), selfMs: r1(ms), selfPct: pct(ms) })).sort((a, b) => b.selfMs - a.selfMs).slice(0, 10),
        note: "selfPct = share of busy main-thread time spent in the function itself; totalPct includes callees. heaviestSubtrees lists branch points only (wrappers that just forward to one callee are skipped). wasm frames appear as wasm-function[N] unless the build keeps a name section (debug export).",
      };
    } finally { profiling = false; }
  }

  // ---- commands ----------------------------------------------------------
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  function gameCanvas() {
    const list = Array.prototype.slice.call(document.querySelectorAll("canvas"));
    list.sort((a, b) => b.width * b.height - a.width * a.height);
    return list[0] || null;
  }
  const KEYCODES = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, " ": 32, Enter: 13, Escape: 27, Shift: 16, Control: 17, Alt: 18, Tab: 9, Backspace: 8, Delete: 46 };
  function keyInfo(key, code) {
    let keyCode = KEYCODES[key];
    if (!code) {
      if (/^[a-zA-Z]$/.test(key)) code = "Key" + key.toUpperCase();
      else if (/^[0-9]$/.test(key)) code = "Digit" + key;
      else if (key === " ") code = "Space";
      else if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") code = key + "Left";
      else code = key;
    }
    if (keyCode === undefined) {
      if (/^[a-zA-Z0-9]$/.test(key)) keyCode = key.toUpperCase().charCodeAt(0);
      else keyCode = 0;
    }
    return { code: code, keyCode: keyCode };
  }

  async function run(cmd) {
    switch (cmd.kind) {
      case "eval": {
        let fn;
        try { fn = new AsyncFunction("return (" + cmd.code + "\n)"); } catch (_) { fn = new AsyncFunction(cmd.code); }
        return serialize(await fn());
      }
      case "screenshot": {
        const c = gameCanvas();
        if (!c) throw new Error("No <canvas> element found in the game page");
        // Wait for the next frame after the game has drawn so the buffer is fresh.
        await new Promise((r) => setTimeout(() => requestAnimationFrame(r), 0));
        return { dataUrl: c.toDataURL("image/png"), width: c.width, height: c.height };
      }
      case "key": {
        const active = document.activeElement;
        const el = active && active !== document.body && active !== document.documentElement ? active : (gameCanvas() || document.body);
        const info = keyInfo(cmd.key, cmd.code);
        const init = {
          key: cmd.key, code: info.code, keyCode: cmd.keyCode || info.keyCode, which: cmd.keyCode || info.keyCode,
          bubbles: true, cancelable: true, composed: true,
          shiftKey: !!cmd.shift, ctrlKey: !!cmd.ctrl, altKey: !!cmd.alt, metaKey: !!cmd.meta,
        };
        el.dispatchEvent(new KeyboardEvent("keydown", init));
        if (cmd.key.length === 1) el.dispatchEvent(new KeyboardEvent("keypress", init));
        await sleep(cmd.holdMs == null ? 100 : cmd.holdMs);
        el.dispatchEvent(new KeyboardEvent("keyup", init));
        return { key: cmd.key, code: info.code, holdMs: cmd.holdMs == null ? 100 : cmd.holdMs, target: "<" + el.tagName.toLowerCase() + ">" };
      }
      case "click": {
        const c = gameCanvas() || document.body;
        const r = c.getBoundingClientRect();
        const x = cmd.unit === "fraction" ? r.left + cmd.x * r.width : r.left + cmd.x;
        const y = cmd.unit === "fraction" ? r.top + cmd.y * r.height : r.top + cmd.y;
        const el = document.elementFromPoint(x, y) || c;
        const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true, view: window };
        const fire = (Ctor, type, extra) => el.dispatchEvent(new Ctor(type, Object.assign({}, base, extra || {})));
        fire(PointerEvent, "pointermove", { buttons: 0 }); fire(MouseEvent, "mousemove", { buttons: 0 });
        fire(PointerEvent, "pointerdown", { buttons: 1 }); fire(MouseEvent, "mousedown", { buttons: 1 });
        await sleep(cmd.holdMs == null ? 60 : cmd.holdMs);
        fire(PointerEvent, "pointerup", { buttons: 0 }); fire(MouseEvent, "mouseup", { buttons: 0 });
        fire(MouseEvent, "click", { buttons: 0 });
        return { x: Math.round(x - r.left), y: Math.round(y - r.top), target: "<" + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + ">" };
      }
      case "metrics": return metrics();
      case "load_timeline": return loadTimeline();
      case "reset_hitches": window.__gp.resetHitches(); return { ok: true };
      case "profile": return profile(cmd.durationMs);
      case "game_state": return gameSnapshot(true);
      case "game_command": return gameCommand(cmd.name, cmd.args);
      case "visibility": return { visibilityState: window.__gp.setVisibility(cmd.hidden === undefined ? null : cmd.hidden) };
      case "lose_context": return window.__gp.loseContext(cmd.restoreAfterMs);
      default:
        throw new Error("Unknown command: " + cmd.kind);
    }
  }

  window.addEventListener("message", async (e) => {
    const m = e.data;
    if (!m || m.__gp !== 1 || m.type !== "cmd") return;
    try { post({ type: "result", id: m.id, ok: true, value: await run(m) }); }
    catch (err) { post({ type: "result", id: m.id, ok: false, error: String((err && err.message) || err) }); }
  });
})();
`;
