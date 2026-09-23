// "Lab" side of the preview: a real Chromium driven by Playwright, pointed at
// the same local server as the panel iframe. Gives trusted input, device
// emulation, CPU/network throttling, Chrome performance tracing, Playwright
// traces, video, HAR, and a fake Gamepad API. One Lab per canvas instance.

import path from "node:path";
import { mkdir, open, rm } from "node:fs/promises";

export const NETWORK_PRESETS = {
    offline: { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 },
    "slow-3g": { offline: false, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8, latency: 2000 },
    "fast-3g": { offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 562 },
    "4g": { offline: false, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8, latency: 60 },
    wifi: { offline: false, downloadThroughput: (30 * 1024 * 1024) / 8, uploadThroughput: (15 * 1024 * 1024) / 8, latency: 2 },
    none: { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 },
};
export const NETWORK_PRESET_NAMES = Object.keys(NETWORK_PRESETS);

const TRACE_CATEGORIES = [
    "-*", "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
    "v8.execute", "v8", "blink.user_timing", "blink", "gpu", "cc", "toplevel", "disabled-by-default-v8.cpu_profiler",
];

// Installed before any game script: a controllable Gamepad API. Inert until
// __gpPad.connect() is called, so real controllers keep working.
export const GAMEPAD_SHIM = String.raw`(() => {
  const pads = [null, null, null, null];
  const realGet = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
  const blankButtons = () => Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  function makePad(index) {
    return { id: "Game Preview Virtual Gamepad (STANDARD GAMEPAD Vendor: 0000 Product: 0000)", index, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: blankButtons(), timestamp: performance.now(), vibrationActuator: null };
  }
  navigator.getGamepads = function () {
    const real = Array.from(realGet() || []);
    for (let i = 0; i < 4; i++) if (pads[i]) { pads[i].timestamp = performance.now(); real[i] = pads[i]; }
    return real;
  };
  function fire(type, pad) { const e = new Event(type); Object.defineProperty(e, "gamepad", { value: pad }); window.dispatchEvent(e); }
  window.__gpPad = {
    connect(index) { index = index || 0; if (!pads[index]) { pads[index] = makePad(index); fire("gamepadconnected", pads[index]); } return pads[index].id; },
    disconnect(index) { index = index || 0; const p = pads[index]; if (p) { pads[index] = null; p.connected = false; fire("gamepaddisconnected", p); } },
    set(index, state) {
      index = index || 0; if (!pads[index]) this.connect(index);
      const p = pads[index];
      if (state.buttons) for (const k in state.buttons) { const v = Number(state.buttons[k]); p.buttons[k] = { pressed: v > 0.5, touched: v > 0, value: v }; }
      if (state.axes) state.axes.forEach((v, i) => { if (v !== null && v !== undefined) p.axes[i] = Number(v); });
      return { buttons: p.buttons.map((b) => b.value), axes: p.axes.slice() };
    },
    reset(index) { index = index || 0; if (pads[index]) { pads[index].buttons = blankButtons(); pads[index].axes = [0, 0, 0, 0]; } },
  };
})();`;

const BUTTON_NAMES = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, select: 8, start: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15, home: 16 };

let playwrightPromise;
async function pw() {
    playwrightPromise ??= import("playwright").catch((err) => {
        throw new Error(`Playwright is not installed (${err.message}). Run: npm install playwright && npx playwright install chromium`);
    });
    return playwrightPromise;
}

export class Lab {
    constructor({ baseUrl, gamePath, filesDir, log }) {
        this.baseUrl = baseUrl;
        this.gamePath = gamePath;
        this.filesDir = filesDir;
        this.log = log;
        this.browser = null; this.context = null; this.page = null; this.cdp = null;
        this.opts = null;
        this.logs = [];
        this.throttle = { cpu: 1, network: "none" };
        this.chromeTrace = null;      // { events:[], startedAt, name }
        this.pwTrace = null;          // { name }
        this.artifacts = [];
    }

    get running() { return !!this.page && !this.page.isClosed(); }

    async open(input = {}) {
        if (this.running) await this.close();
        const { chromium, devices } = await pw();
        await mkdir(this.filesDir, { recursive: true });
        const headless = input.headless === true;
        const device = input.device ? devices[input.device] : null;
        if (input.device && !device) {
            const names = Object.keys(devices).filter((n) => !/landscape/i.test(n));
            throw new Error(`Unknown device "${input.device}". Examples: ${names.filter((n) => /iPhone 1[45]|Pixel 7|iPad \(gen 7\)|Galaxy S9\+|Desktop Chrome$/.test(n)).join(", ")} (${names.length} available).`);
        }
        const viewport = { width: input.width ?? device?.viewport.width ?? 1280, height: input.height ?? device?.viewport.height ?? 720 };
        if (input.landscape && viewport.width < viewport.height) [viewport.width, viewport.height] = [viewport.height, viewport.width];
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

        this.browser = await chromium.launch({
            headless,
            args: ["--autoplay-policy=no-user-gesture-required", "--enable-features=SharedArrayBuffer", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"].concat(headless ? ["--use-gl=angle", "--use-angle=swiftshader"] : []),
        });
        const ctxOpts = {
            ...(device ?? {}),
            viewport,
            deviceScaleFactor: input.deviceScaleFactor ?? device?.deviceScaleFactor ?? 1,
            hasTouch: input.touch ?? device?.hasTouch ?? false,
            isMobile: input.isMobile ?? device?.isMobile ?? false,
            userAgent: input.userAgent ?? device?.userAgent,
            colorScheme: input.colorScheme,
            locale: input.locale,
            ignoreHTTPSErrors: true,
        };
        if (input.video) ctxOpts.recordVideo = { dir: path.join(this.filesDir, "video"), size: viewport };
        if (input.har) ctxOpts.recordHar = { path: path.join(this.filesDir, `lab-${stamp}.har`), content: "omit" };
        this.context = await this.browser.newContext(ctxOpts);
        await this.context.addInitScript(GAMEPAD_SHIM);
        this.page = await this.context.newPage();
        this.logs = [];
        this.page.on("console", (m) => this.pushLog(m.type() === "warning" ? "warn" : m.type() === "error" ? "error" : m.type() === "debug" ? "debug" : "log", m.text()));
        this.page.on("pageerror", (e) => this.pushLog("error", e.message, e.stack));
        this.page.on("requestfailed", (r) => this.pushLog("warn", `request failed: ${r.url().replace(this.baseUrl, "")} (${r.failure()?.errorText})`));
        this.page.on("crash", () => this.pushLog("error", "page crashed"));
        this.page.on("close", () => { this.page = null; });
        this.cdp = await this.context.newCDPSession(this.page);
        this.opts = { headless, device: input.device ?? null, profile: input.profile ?? null, viewport, deviceScaleFactor: ctxOpts.deviceScaleFactor, touch: ctxOpts.hasTouch, video: !!input.video, har: !!input.har, harPath: ctxOpts.recordHar?.path };
        if (input.cpu || input.network) await this.setThrottle({ cpu: input.cpu, network: input.network });

        const url = this.baseUrl + this.gamePath;
        const t0 = Date.now();
        await this.page.goto(url, { waitUntil: "load", timeout: input.timeoutMs ?? 60000 });
        this.log(`gamelab lab: opened ${url} in ${headless ? "headless" : "headed"} Chromium (${viewport.width}×${viewport.height}${input.device ? ", " + input.device : ""})`);
        return { ...this.status(), loadMs: Date.now() - t0, url };
    }

    pushLog(level, text, stack) {
        this.logs.push({ level, text, stack, t: Date.now() });
        if (this.logs.length > 2000) this.logs.splice(0, this.logs.length - 2000);
    }

    status() {
        return {
            running: this.running,
            browser: this.browser ? `Chromium ${this.browser.version()}` : null,
            ...(this.opts ?? {}),
            throttle: this.throttle,
            tracing: { chrome: this.chromeTrace ? { name: this.chromeTrace.name, seconds: Math.round((Date.now() - this.chromeTrace.startedAt) / 1000) } : null, playwright: this.pwTrace?.name ?? null },
            consoleErrors: this.logs.filter((l) => l.level === "error").length,
            artifacts: this.artifacts.slice(-10),
        };
    }

    ensure() {
        if (!this.running) throw new Error("The lab browser is not running. Call lab_open first.");
        return this.page;
    }

    async close() {
        const out = { artifacts: [] };
        if (this.chromeTrace) { try { out.artifacts.push(await this.traceStop("chrome")); } catch { /* ignore */ } }
        if (this.pwTrace) { try { out.artifacts.push(await this.traceStop("playwright")); } catch { /* ignore */ } }
        const video = this.page && !this.page.isClosed() ? this.page.video() : null;
        try { await this.context?.close(); } catch { /* ignore */ }
        if (video) {
            try {
                const tmp = await video.path();
                const dest = path.join(this.filesDir, `lab-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.webm`);
                await video.saveAs(dest); await rm(tmp, { force: true });
                out.video = dest; out.artifacts.push({ kind: "video", path: dest });
            } catch (err) { out.videoError = err.message; }
        }
        if (this.opts?.harPath) { out.har = this.opts.harPath; out.artifacts.push({ kind: "har", path: this.opts.harPath }); }
        try { await this.browser?.close(); } catch { /* ignore */ }
        this.browser = this.context = this.page = this.cdp = null;
        this.opts = null; this.throttle = { cpu: 1, network: "none" };
        this.artifacts.push(...out.artifacts);
        return out;
    }

    // ---- input ---------------------------------------------------------------
    async canvasBox() {
        const page = this.ensure();
        const box = await page.evaluate(() => {
            const list = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height);
            const r = (list[0] || document.body).getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
        });
        return box;
    }
    async toPagePoint(x, y, unit) {
        const box = await this.canvasBox();
        return unit === "fraction" ? { x: box.x + x * box.width, y: box.y + y * box.height } : { x: box.x + x, y: box.y + y };
    }
    async pressKey({ key, holdMs = 100, shift, ctrl, alt, meta }) {
        const page = this.ensure();
        const mods = [shift && "Shift", ctrl && "Control", alt && "Alt", meta && "Meta"].filter(Boolean);
        for (const m of mods) await page.keyboard.down(m);
        await page.keyboard.down(key);
        await page.waitForTimeout(holdMs);
        await page.keyboard.up(key);
        for (const m of mods.reverse()) await page.keyboard.up(m);
        return { key, holdMs, trusted: true };
    }
    async click({ x, y, unit, button = "left", holdMs = 60 }) {
        const page = this.ensure();
        const p = await this.toPagePoint(x, y, unit);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down({ button });
        await page.waitForTimeout(holdMs);
        await page.mouse.up({ button });
        return { x: Math.round(p.x), y: Math.round(p.y), button, trusted: true };
    }
    async touch({ kind = "tap", x, y, x2, y2, unit, durationMs = 250, steps = 12 }) {
        this.ensure();
        if (!this.opts.touch) throw new Error("Touch is not enabled in this lab browser. Re-open with touch: true or a mobile device preset.");
        const from = await this.toPagePoint(x, y, unit);
        const tp = (pt) => ({ x: pt.x, y: pt.y, radiusX: 4, radiusY: 4, force: 1, id: 1 });
        if (kind === "tap") {
            await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tp(from)] });
            await this.page.waitForTimeout(Math.min(durationMs, 120));
            await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            return { kind, x: Math.round(from.x), y: Math.round(from.y) };
        }
        if (kind === "swipe") {
            if (x2 === undefined || y2 === undefined) throw new Error("swipe needs x2/y2");
            const to = await this.toPagePoint(x2, y2, unit);
            await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tp(from)] });
            for (let i = 1; i <= steps; i++) {
                const pt = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
                await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [tp(pt)] });
                await this.page.waitForTimeout(durationMs / steps);
            }
            await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            return { kind, from: [Math.round(from.x), Math.round(from.y)], to: [Math.round(to.x), Math.round(to.y)], durationMs };
        }
        if (kind === "hold") {
            await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tp(from)] });
            await this.page.waitForTimeout(durationMs);
            await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            return { kind, x: Math.round(from.x), y: Math.round(from.y), durationMs };
        }
        throw new Error(`Unknown touch kind "${kind}"`);
    }
    async gamepad({ action = "set", index = 0, buttons, axes, holdMs }) {
        const page = this.ensure();
        if (action === "connect") return { id: await page.evaluate((i) => window.__gpPad.connect(i), index) };
        if (action === "disconnect") { await page.evaluate((i) => window.__gpPad.disconnect(i), index); return { disconnected: index }; }
        if (action === "reset") { await page.evaluate((i) => window.__gpPad.reset(i), index); return { reset: index }; }
        const mapped = {};
        for (const [k, v] of Object.entries(buttons ?? {})) {
            const idx = k in BUTTON_NAMES ? BUTTON_NAMES[k] : Number(k);
            if (!Number.isInteger(idx) || idx < 0 || idx > 16) throw new Error(`Unknown gamepad button "${k}". Use 0-16 or ${Object.keys(BUTTON_NAMES).join("/")}.`);
            mapped[idx] = v === true ? 1 : v === false ? 0 : Number(v);
        }
        const state = await page.evaluate(([i, s]) => window.__gpPad.set(i, s), [index, { buttons: mapped, axes }]);
        if (holdMs) {
            await page.waitForTimeout(holdMs);
            const release = Object.fromEntries(Object.keys(mapped).map((k) => [k, 0]));
            await page.evaluate(([i, s]) => window.__gpPad.set(i, s), [index, { buttons: release, axes: axes ? axes.map(() => 0) : undefined }]);
        }
        return { index, ...state, heldMs: holdMs ?? null };
    }

    // ---- page state ----------------------------------------------------------
    async evaluate(code, timeoutMs = 15000) {
        const page = this.ensure();
        const run = page.evaluate(async (src) => {
            const AF = Object.getPrototypeOf(async function () {}).constructor;
            let fn; try { fn = new AF("return (" + src + "\n)"); } catch { fn = new AF(src); }
            const v = await fn();
            try { JSON.stringify(v); return v; } catch { return String(v); }
        }, code);
        let timer;
        const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`eval timed out after ${timeoutMs} ms`)), timeoutMs); });
        try { return await Promise.race([run, timeout]); } finally { clearTimeout(timer); }
    }
    async hookCall(expr) {
        const page = this.ensure();
        const has = await page.evaluate(() => !!window.__gp);
        if (!has) throw new Error("The gamelab hook is not present in the lab page (was the page served through the preview server?).");
        return page.evaluate(expr);
    }
    async screenshot(name = "lab", { fullPage = false } = {}) {
        const page = this.ensure();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const file = path.join(this.filesDir, `${name.replace(/[^\w.-]+/g, "_")}-${stamp}.png`);
        await page.screenshot({ path: file, fullPage, animations: "allow" });
        const vp = page.viewportSize();
        this.artifacts.push({ kind: "screenshot", path: file });
        return { path: file, width: vp?.width, height: vp?.height, hint: "Open `path` to look at the frame." };
    }
    getLogs({ level = "all", limit = 200, query, clear } = {}) {
        const min = level === "error" ? 3 : level === "warn" ? 2 : 0;
        const rank = { debug: 0, log: 1, info: 1, warn: 2, error: 3 };
        let out = this.logs.filter((l) => (rank[l.level] ?? 1) >= min && (!query || l.text.includes(query)));
        const total = out.length;
        out = out.slice(-limit);
        if (clear) this.logs = [];
        return { total, entries: out };
    }
    async reload() { const page = this.ensure(); this.logs = []; await page.reload({ waitUntil: "load" }); return { reloaded: true }; }

    // ---- CPU headroom sweep ------------------------------------------------------
    // Slows the CPU step by step and measures frame time at each step, so you learn how
    // much slower a device can be before the game drops below the target fps.
    async headroom({ steps = [1, 2, 4, 6, 8], holdMs = 4000, settleMs = 800, targetFps = 30 } = {}) {
        this.ensure();
        steps = [...new Set(steps.map(Number).filter((x) => x >= 1 && x <= 20))].sort((a, b) => a - b);
        if (!steps.length) throw new Error("steps must be CPU slowdown factors between 1 and 20, e.g. [1, 2, 4, 6]");
        const prev = this.throttle.cpu, results = [];
        let breaksAt = null, lastOk = null;
        try {
            for (const cpu of steps) {
                await this.setThrottle({ cpu });
                await new Promise((r) => setTimeout(r, settleMs));
                await this.hookCall("window.__gp.resetHitches()");
                await new Promise((r) => setTimeout(r, holdMs));
                const m = await this.hookCall("window.__gp.metrics()");
                const f = m.frame || {}, fps = f.p50Ms ? Math.round(1000 / f.p50Ms) : null;
                const row = { cpu, fps, p50Ms: f.p50Ms, p95Ms: f.p95Ms, low1PctFps: f.low1PctFps, mainThreadMs: m.cpu?.p50Ms ?? null, gpuMs: m.gpu?.p50Ms ?? null, hitches: m.hitches?.count ?? 0, bound: m.bound?.kind ?? null, samples: f.samples ?? 0 };
                results.push(row);
                if (fps != null && fps >= targetFps) lastOk = cpu;
                else if (fps != null && breaksAt === null) { breaksAt = cpu; break; }
            }
        } finally {
            await this.setThrottle({ cpu: prev }).catch(() => {});
        }
        const cls = (x) => (x == null ? "?" : x >= 8 ? "very low-end phones" : x >= 6 ? "low-end phones" : x >= 4 ? "mid-range phones" : x >= 2 ? "high-end phones / old laptops" : "desktop only");
        const verdict = lastOk === null
            ? `Below ${targetFps} fps even with no CPU slowdown — optimise before testing on devices.`
            : breaksAt === null
                ? `Holds ≥${targetFps} fps up to ${lastOk}× slower CPU (${cls(lastOk)}) — did not break within the sweep.`
                : `Holds ≥${targetFps} fps up to ${lastOk}× slower CPU (${cls(lastOk)}); drops to ${results[results.length - 1].fps} fps at ${breaksAt}× (${cls(breaksAt)}).`;
        const last = results[results.length - 1];
        const hint = last?.bound === "cpu" || (last?.mainThreadMs && last.p50Ms && last.mainThreadMs >= last.p50Ms * 0.7)
            ? "The main thread is the limit under throttling — profile it (profile tool) to find the hot functions."
            : last?.bound === "gpu" || last?.bound === "gpu?" ? "Frame time barely moved with CPU slowdown — the limit is the GPU (fill rate / draw calls), not scripts." : null;
        return { targetFps, holdMs, steps: results, maxOkSlowdown: lastOk, breaksAt, verdict, hint, scale: "Chrome DevTools guidance: 4× ≈ mid-tier phone, 6× ≈ low-end phone. CPU throttling does not slow the GPU." };
    }

    // ---- emulation -----------------------------------------------------------
    async setThrottle({ cpu, network }) {
        this.ensure();
        if (cpu !== undefined) {
            if (!(cpu >= 1 && cpu <= 20)) throw new Error("cpu must be a slowdown factor between 1 (none) and 20");
            await this.cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
            this.throttle.cpu = cpu;
        }
        if (network !== undefined) {
            let cond;
            if (typeof network === "string") {
                cond = NETWORK_PRESETS[network];
                if (!cond) throw new Error(`Unknown network preset "${network}". Use ${NETWORK_PRESET_NAMES.join(", ")} or {downloadKbps, uploadKbps, latencyMs}.`);
            } else {
                cond = { offline: !!network.offline, downloadThroughput: network.downloadKbps ? (network.downloadKbps * 1024) / 8 : -1, uploadThroughput: network.uploadKbps ? (network.uploadKbps * 1024) / 8 : -1, latency: network.latencyMs ?? 0 };
            }
            await this.cdp.send("Network.enable");
            await this.cdp.send("Network.emulateNetworkConditions", cond);
            this.throttle.network = network;
        }
        return this.throttle;
    }
    async setVisibility(hidden) {
        this.ensure();
        // Real lifecycle transition (throttles timers/rAF like a background tab) plus the hook's document.hidden override.
        await this.cdp.send("Page.setWebLifecycleState", { state: hidden ? "frozen" : "active" }).catch(() => {});
        return this.hookCall(`(() => window.__gp.setVisibility(${hidden === null ? "null" : !!hidden}))()`);
    }

    // ---- tracing ---------------------------------------------------------------
    async traceStart(kind = "chrome", { name = "trace", screenshots = true, snapshots = false } = {}) {
        this.ensure();
        if (kind === "playwright") {
            if (this.pwTrace) throw new Error("A Playwright trace is already recording");
            await this.context.tracing.start({ screenshots, snapshots, sources: false, title: name });
            this.pwTrace = { name, startedAt: Date.now() };
            return { kind, name, startedAt: this.pwTrace.startedAt };
        }
        if (this.chromeTrace) throw new Error("A Chrome trace is already recording");
        const events = [];
        this.chromeTrace = { name, startedAt: Date.now(), events, onData: (p) => { for (const e of p.value) events.push(e); } };
        this.cdp.on("Tracing.dataCollected", this.chromeTrace.onData);
        await this.cdp.send("Tracing.start", { traceConfig: { includedCategories: TRACE_CATEGORIES.filter((c) => c !== "-*"), excludedCategories: ["*"], recordMode: "recordContinuously" }, transferMode: "ReportEvents" });
        return { kind, name, startedAt: this.chromeTrace.startedAt, hint: "Play the scenario you want to profile, then call trace_stop." };
    }
    async traceStop(kind = "chrome") {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        if (kind === "playwright") {
            if (!this.pwTrace) throw new Error("No Playwright trace is recording");
            const file = path.join(this.filesDir, `${this.pwTrace.name.replace(/[^\w.-]+/g, "_")}-${stamp}.pw.zip`);
            await this.context.tracing.stop({ path: file });
            const seconds = Math.round((Date.now() - this.pwTrace.startedAt) / 1000);
            this.pwTrace = null;
            const art = { kind: "playwright-trace", path: file, seconds, open: `npx playwright show-trace "${file}"` };
            this.artifacts.push(art);
            return art;
        }
        if (!this.chromeTrace) throw new Error("No Chrome trace is recording");
        const t = this.chromeTrace;
        await new Promise((resolve) => { this.cdp.once("Tracing.tracingComplete", resolve); this.cdp.send("Tracing.end").catch(resolve); });
        this.cdp.off("Tracing.dataCollected", t.onData);
        this.chromeTrace = null;
        const file = path.join(this.filesDir, `${t.name.replace(/[^\w.-]+/g, "_")}-${stamp}.trace.json`);
        await writeTraceFile(file, t.events);
        const summary = summarizeTrace(t.events);
        const art = { kind: "chrome-trace", path: file, seconds: Math.round((Date.now() - t.startedAt) / 1000), events: t.events.length, summary, open: "Load the .trace.json in https://ui.perfetto.dev or Chrome DevTools › Performance › Load profile" };
        this.artifacts.push(art);
        return art;
    }
}

async function writeTraceFile(file, events) {
    const fh = await open(file, "w");
    try {
        await fh.write('{"traceEvents":[');
        for (let i = 0; i < events.length; i += 5000) {
            const chunk = events.slice(i, i + 5000).map((e) => JSON.stringify(e)).join(",");
            await fh.write((i ? "," : "") + chunk);
        }
        await fh.write("]}");
    } finally { await fh.close(); }
}

/** Condense raw trace events into the numbers you'd read off DevTools' Summary/Bottom-up panes. */
export function summarizeTrace(events) {
    const byName = new Map();
    const longTasks = [];
    let t0 = Infinity, tEnd = 0, drawFrames = 0;
    for (const e of events) {
        if (typeof e.ts === "number" && e.ts > 0) { if (e.ts < t0) t0 = e.ts; const end = e.ts + (e.dur || 0); if (end > tEnd) tEnd = end; }
        if (e.name === "DrawFrame") drawFrames++;
        if (e.ph !== "X" || typeof e.dur !== "number") continue;
        const cur = byName.get(e.name) ?? { name: e.name, count: 0, totalMs: 0, maxMs: 0 };
        cur.count++; cur.totalMs += e.dur / 1000; cur.maxMs = Math.max(cur.maxMs, e.dur / 1000);
        byName.set(e.name, cur);
        if ((e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") && e.dur > 50000) longTasks.push(e);
    }
    longTasks.sort((a, b) => b.dur - a.dur);
    const gc = [...byName.values()].filter((b) => /GC|GarbageCollect/i.test(b.name));
    const wallMs = t0 < Infinity ? (tEnd - t0) / 1000 : 0;
    const round = (n) => Math.round(n * 10) / 10;
    return {
        wallMs: round(wallMs),
        drawFrames,
        approxFps: wallMs > 0 && drawFrames ? round((drawFrames * 1000) / wallMs) : null,
        longTasks: { count: longTasks.length, totalMs: round(longTasks.reduce((a, e) => a + e.dur / 1000, 0)), worst: longTasks.slice(0, 5).map((e) => ({ atMs: round((e.ts - t0) / 1000), durMs: round(e.dur / 1000) })) },
        gcMs: round(gc.reduce((a, b) => a + b.totalMs, 0)),
        topEvents: [...byName.values()].filter((b) => !/^(RunTask|ThreadControllerImpl::RunTask|MessageLoop::RunTask|TaskQueueManager::ProcessTaskFromWorkQueue)$/.test(b.name)).sort((a, b) => b.totalMs - a.totalMs).slice(0, 12).map((b) => ({ name: b.name, count: b.count, totalMs: round(b.totalMs), maxMs: round(b.maxMs) })),
        note: "Event totals are inclusive (nested events double count); compare relative sizes, and open the file in Perfetto for the flame chart.",
    };
}
