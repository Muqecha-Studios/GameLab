// Script injected into the game's HTML. Runs inside the game iframe and talks
// to the shell page via postMessage: console/error capture, FPS + heap
// sampling, environment probe, and a small command channel (eval,
// screenshot, synthetic input) used by the agent actions.

export const HOOK_JS = String.raw`(() => {
  if (window.__gamePreviewHook) return;
  window.__gamePreviewHook = true;

  const post = (msg) => { try { parent.postMessage(Object.assign({ __gp: 1 }, msg), "*"); } catch (_) {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // ---- WebGL instrumentation ---------------------------------------------
  // Counters are cumulative; the frame sampler diffs them per rAF tick.
  const gl = { draws: 0, instances: 0, texUploads: 0, shaderCompiles: 0, programLinks: 0, bufferUploads: 0, contextLost: 0, firstDrawAt: null };
  const glContexts = new Set();
  function wrap(proto, name, fn) {
    if (!proto || typeof proto[name] !== "function") return;
    const orig = proto[name];
    proto[name] = function () { fn.apply(this, arguments); return orig.apply(this, arguments); };
  }
  function markDraw(count) { gl.draws++; gl.instances += count || 1; if (gl.firstDrawAt === null) gl.firstDrawAt = performance.now(); }
  for (const P of [typeof WebGLRenderingContext !== "undefined" ? WebGLRenderingContext.prototype : null, typeof WebGL2RenderingContext !== "undefined" ? WebGL2RenderingContext.prototype : null]) {
    if (!P) continue;
    wrap(P, "drawArrays", () => markDraw(1));
    wrap(P, "drawElements", () => markDraw(1));
    wrap(P, "drawArraysInstanced", (m, f, c, n) => markDraw(n));
    wrap(P, "drawElementsInstanced", (m, c, t, o, n) => markDraw(n));
    wrap(P, "drawRangeElements", () => markDraw(1));
    wrap(P, "texImage2D", () => gl.texUploads++);
    wrap(P, "texSubImage2D", () => gl.texUploads++);
    wrap(P, "compressedTexImage2D", () => gl.texUploads++);
    wrap(P, "texImage3D", () => gl.texUploads++);
    wrap(P, "compileShader", () => gl.shaderCompiles++);
    wrap(P, "linkProgram", () => gl.programLinks++);
    wrap(P, "bufferData", () => gl.bufferUploads++);
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

  // Keep the WebGL back buffer around so screenshots are not blank, and
  // remember contexts so we can simulate context loss.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (typeof type === "string" && type.indexOf("webgl") === 0) attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
    const ctx = getContext.call(this, type, attrs);
    if (ctx && typeof type === "string" && type.indexOf("webgl") === 0 && !glContexts.has(ctx)) {
      glContexts.add(ctx);
      this.addEventListener("webglcontextlost", () => { gl.contextLost++; post({ type: "console", level: "warn", text: "[game-preview] webglcontextlost", t: Date.now() }); });
      this.addEventListener("webglcontextrestored", () => post({ type: "console", level: "info", text: "[game-preview] webglcontextrestored", t: Date.now() }));
    }
    return ctx;
  };

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
      const c = document.createElement("canvas");
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
    },
  });

  // ---- FPS / frame time / heap / hitches / draw calls --------------------
  const HITCH_MS = 50, HITCH_MAX = 300;
  const hitches = [];               // { at: ms since timeOrigin, dt }
  let firstFrameAt = null, frameIndex = 0;
  let frames = 0, windowStart = performance.now(), prev = windowStart, worst = 0;
  let lastDraws = gl.draws, windowDraws = 0, lastFrameDraws = 0;
  const frameTimes = [];            // last 600 frame dts for percentiles
  function tick(now) {
    frames++; frameIndex++;
    if (firstFrameAt === null) firstFrameAt = now;
    const dt = now - prev; prev = now;
    if (frameIndex > 1) {
      if (dt > worst) worst = dt;
      frameTimes.push(dt); if (frameTimes.length > 600) frameTimes.shift();
      if (dt > HITCH_MS && !document.hidden) { hitches.push({ at: Math.round(now), dt: Math.round(dt * 10) / 10, draws: lastFrameDraws }); if (hitches.length > HITCH_MAX) hitches.shift(); }
    }
    lastFrameDraws = gl.draws - lastDraws; lastDraws = gl.draws; windowDraws += lastFrameDraws;
    if (now - windowStart >= 500) {
      const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      post({ type: "fps", fps: Math.round((frames * 1000) / (now - windowStart)), worstMs: Math.round(worst * 10) / 10, heapMB: mem, drawCalls: Math.round(windowDraws / frames), t: Date.now() });
      frames = 0; worst = 0; windowStart = now; windowDraws = 0;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function percentile(arr, p) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  }
  function metrics() {
    const wasm = performance.getEntriesByType("resource").filter((r) => /\.wasm(\?|$)/.test(r.name));
    return {
      frame: { lastDrawCalls: lastFrameDraws, p50Ms: percentile(frameTimes, 0.5), p95Ms: percentile(frameTimes, 0.95), p99Ms: percentile(frameTimes, 0.99), maxMs: percentile(frameTimes, 1), samples: frameTimes.length },
      hitches: { count: hitches.length, thresholdMs: HITCH_MS, recent: hitches.slice(-20) },
      webgl: { drawCallsTotal: gl.draws, instancesTotal: gl.instances, textureUploads: gl.texUploads, shaderCompiles: gl.shaderCompiles, programLinks: gl.programLinks, bufferUploads: gl.bufferUploads, contextLostCount: gl.contextLost, contexts: glContexts.size },
      memory: { heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, heapLimitMB: performance.memory ? Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null, wasmBytes: wasm.reduce((a, r) => a + (r.decodedBodySize || 0), 0) || null },
      visibility: document.visibilityState,
      uptimeMs: Math.round(performance.now()),
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
    resetHitches: () => { hitches.length = 0; frameTimes.length = 0; },
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
  };

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
