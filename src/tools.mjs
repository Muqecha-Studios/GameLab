// Tool catalogue: the single source of truth for what an agent can do with a
// Preview. Every host (MCP server, CLI, Copilot canvas, your own script) maps
// these onto its own surface. Handlers take (preview, input) and return JSON.

import path from "node:path";
import { GameLabError, VIEWPORTS, CMD_TIMEOUT_MS, expandHome, labCall } from "./preview.mjs";
import { NETWORK_PRESET_NAMES } from "./lab.mjs";
import { runScenario, STEP_SCHEMA, STEP_KINDS } from "./scenario.mjs";
import { exportTest } from "./export.mjs";

export { STEP_SCHEMA, STEP_KINDS, NETWORK_PRESET_NAMES, VIEWPORTS };

export const TARGET_PROP = {
    type: "string",
    enum: ["panel", "lab", "auto"],
    description: "Where to act: panel (the attached browser/iframe showing the shell UI), lab (the Playwright Chromium from lab_open), or auto (lab if running, else panel). Default depends on the host: panel for embedded canvases, auto elsewhere.",
};

/** Input accepted when opening a preview (MCP `open` tool, CLI flags, canvas open input). */
export const OPEN_INPUT_SCHEMA = {
    type: "object",
    properties: {
        url: { type: "string", description: "URL of a running dev server to preview (e.g. http://localhost:5173/). Proxied so console/FPS capture works; HMR WebSockets pass through." },
        dir: { type: "string", description: "Absolute path to a folder containing a built web game (index.html, Godot HTML export, Unity WebGL build). Served with correct MIME/encoding headers. Defaults to the working directory (or its dist/build/builds/web/export/web/public) when it has an .html entry." },
        entry: { type: "string", description: "HTML entry relative to dir. Auto-detected (index.html, or the export's .html)." },
        watch: { type: ["boolean", "string"], description: "Auto-reload when files change. true (default in dir mode) watches dir; a path watches that folder instead (useful with url mode); false disables." },
        isolation: { type: "string", enum: ["auto", "on", "off"], description: "Send COOP/COEP headers so SharedArrayBuffer works (needed by Godot thread-enabled exports). auto = on when the folder looks like a wasm export." },
        viewport: { type: "string", description: `Initial viewport preset for the shell UI: ${Object.keys(VIEWPORTS).join(", ")}, or WIDTHxHEIGHT.` },
        title: { type: "string", description: "Optional title." },
    },
    additionalProperties: false,
};

const noInput = { type: "object", properties: {}, additionalProperties: false };

export const TOOLS = [
    {
        name: "reload",
        description: "Reload the game page (like a browser refresh). Resets FPS statistics.",
        inputSchema: { type: "object", properties: { target: TARGET_PROP }, additionalProperties: false },
        handler: (p, i) => p.driverFor(i?.target).reload(),
    },
    {
        name: "get_logs",
        description: "Return captured console output and runtime errors from the game page, newest last. Use after reproducing an issue.",
        inputSchema: {
            type: "object",
            properties: {
                level: { type: "string", enum: ["all", "warn", "error"], description: "Minimum level (default all). 'warn' includes errors." },
                limit: { type: "integer", minimum: 1, maximum: 1000, description: "Max entries to return (default 200)." },
                query: { type: "string", description: "Only entries containing this text." },
                clear: { type: "boolean", description: "Clear the console after reading." },
                target: TARGET_PROP,
            },
            additionalProperties: false,
        },
        handler: (p, i) => { const { target, ...opts } = i ?? {}; return p.driverFor(target).getLogs(opts); },
    },
    {
        name: "clear_logs",
        description: "Clear the captured console.",
        inputSchema: { type: "object", properties: { target: TARGET_PROP }, additionalProperties: false },
        handler: async (p, i) => { await p.driverFor(i?.target).clearLogs(); return { cleared: true }; },
    },
    {
        name: "get_stats",
        description: "Quick snapshot: current/avg/min FPS over the last minute, worst and p95 frame time, JS heap, draw calls/frame, console error counts, WebGL renderer, cross-origin isolation, viewport. For deeper numbers use get_metrics.",
        inputSchema: { type: "object", properties: { target: TARGET_PROP }, additionalProperties: false },
        handler: (p, i) => p.driverFor(i?.target).stats(),
    },
    {
        name: "get_metrics",
        description: "Detailed in-page performance metrics from the hook: frame-time percentiles (p50/p95/p99/max), frame hitches > 50 ms with timestamps, WebGL counters (draw calls, instances, texture uploads, shader compiles, buffer uploads, context losses), heap and wasm size, visibility state.",
        inputSchema: { type: "object", properties: { target: TARGET_PROP, resetHitches: { type: "boolean", description: "Clear the hitch log and frame-time samples after reading." } }, additionalProperties: false },
        handler: async (p, i) => {
            const d = p.driverFor(i?.target ?? "auto");
            const m = await d.metrics();
            if (i?.resetHitches) await d.resetHitches();
            return { target: d.name, ...m };
        },
    },
    {
        name: "get_load_timeline",
        description: "Startup/loading breakdown: navigation timing, time to first animation frame and first WebGL draw, resource count and total bytes, the 10 slowest and 10 largest assets (wasm, pck, data, textures), and performance.mark() entries. Use to find why a build boots slowly.",
        inputSchema: { type: "object", properties: { target: TARGET_PROP }, additionalProperties: false },
        handler: async (p, i) => { const d = p.driverFor(i?.target ?? "auto"); return { target: d.name, ...(await d.loadTimeline()) }; },
    },
    {
        name: "profile",
        description: "Sample the game's main thread for durationMs (default 5000) with the JS Self-Profiling API and return hot functions by self time, heaviest subtrees, per-file totals, busy vs idle %, and GC time — i.e. where the CPU goes in the code. Play/drive the game while it runs (it awaits). Chromium only; wasm frames show as wasm-function[N] unless the export keeps names (debug build).",
        inputSchema: { type: "object", properties: { durationMs: { type: "integer", minimum: 500, maximum: 30000 }, target: TARGET_PROP }, additionalProperties: false },
        handler: async (p, i) => {
            const ms = i?.durationMs ?? 5000;
            let d = p.driverFor(i?.target ?? "auto"), r = await d.profile(ms);
            // Panels embedded in WebKit-based hosts lack the Profiler API: fall back to the lab when one is running.
            if (r?.supported === false && d.name === "panel" && (i?.target ?? "auto") === "auto" && p.lab?.running) { d = p.driverFor("lab"); r = await d.profile(ms); }
            if (r?.supported === false && d.name === "panel") r.hint = "Call lab_open (Playwright Chromium) and retry with target: \"lab\" — the lab always supports profiling.";
            return { target: d.name, ...r };
        },
    },
    {
        name: "screenshot",
        description: "Capture the game to a PNG file and return its path. panel: reads the largest <canvas> (WebGL back buffer). lab: full-page screenshot of the Playwright browser (includes DOM UI). View the file to see what the game looks like.",
        inputSchema: { type: "object", properties: { name: { type: "string", description: "Optional file name (without extension)." }, target: TARGET_PROP }, additionalProperties: false },
        handler: (p, i) => p.driverFor(i?.target).screenshot(i?.name || "shot"),
    },
    {
        name: "eval",
        description: "Run JavaScript inside the game page and return the (JSON-serialized) result. Supports expressions or statements with `return`, and `await`. Use it to inspect or tweak game state, e.g. `window.game.scene.scenes.map(s => s.scene.key)` or `player.x = 100`. `window.__gp` exposes metrics(), loadTimeline(), hitches(), setVisibility(), loseContext().",
        inputSchema: { type: "object", properties: { code: { type: "string" }, timeoutMs: { type: "integer", minimum: 100, maximum: 120000 }, target: TARGET_PROP }, required: ["code"], additionalProperties: false },
        handler: async (p, i) => ({ value: await p.driverFor(i.target).evaluate(i.code, i.timeoutMs ?? CMD_TIMEOUT_MS) }),
    },
    {
        name: "press_key",
        description: "Press a key in the game. panel: synthetic keydown/keyup on the focused element or canvas. lab: trusted OS-level key events via Playwright. Keys use KeyboardEvent.key names: 'ArrowLeft', ' ', 'a', 'Enter', 'Escape'. Sequence multiple calls to play.",
        inputSchema: {
            type: "object",
            properties: {
                key: { type: "string" },
                code: { type: "string", description: "KeyboardEvent.code override (panel only; auto-derived)." },
                holdMs: { type: "integer", minimum: 0, maximum: 10000, description: "Time between keydown and keyup (default 100)." },
                shift: { type: "boolean" }, ctrl: { type: "boolean" }, alt: { type: "boolean" }, meta: { type: "boolean" },
                target: TARGET_PROP,
            },
            required: ["key"],
            additionalProperties: false,
        },
        handler: (p, i) => { const { target, ...o } = i; return p.driverFor(target).key(o); },
    },
    {
        name: "click",
        description: "Click at a position on the game canvas (or whatever element is at that point, e.g. a DOM button). panel: synthetic pointer/mouse events. lab: trusted mouse input.",
        inputSchema: {
            type: "object",
            properties: {
                x: { type: "number" }, y: { type: "number" },
                unit: { type: "string", enum: ["px", "fraction"], description: "px = CSS pixels from the canvas top-left (default); fraction = 0..1 of canvas size." },
                holdMs: { type: "integer", minimum: 0, maximum: 5000 },
                target: TARGET_PROP,
            },
            required: ["x", "y"],
            additionalProperties: false,
        },
        handler: (p, i) => { const { target, ...o } = i; return p.driverFor(target).click(o); },
    },
    {
        name: "set_visibility",
        description: "Simulate the tab going to the background / returning (document.hidden + visibilitychange, and in the lab a real page-lifecycle freeze). Games should pause audio/physics and not explode on resume. hidden: true|false, or null to stop overriding.",
        inputSchema: { type: "object", properties: { hidden: { type: ["boolean", "null"] }, target: TARGET_PROP }, required: ["hidden"], additionalProperties: false },
        handler: (p, i) => p.driverFor(i.target ?? "auto").visibility(i.hidden),
    },
    {
        name: "lose_webgl_context",
        description: "Force a WebGL context loss on the game canvas (WEBGL_lose_context), optionally restoring it after restoreAfterMs. Reproduces what happens on GPU resets, tab discards and some mobile browsers; check get_logs afterwards for the engine's recovery behaviour.",
        inputSchema: { type: "object", properties: { restoreAfterMs: { type: ["integer", "null"], description: "Restore after this delay (default 1000). null = stay lost." }, target: TARGET_PROP }, additionalProperties: false },
        handler: (p, i) => p.driverFor(i?.target ?? "auto").loseContext(i?.restoreAfterMs === undefined ? 1000 : i.restoreAfterMs),
    },
    {
        name: "set_viewport",
        description: `Resize the game frame in the shell UI to a device/resolution preset (${Object.keys(VIEWPORTS).join(", ")}) or WIDTHxHEIGHT, scaled to fit. Optionally rotate. (Panel only; for the lab pass device/width/height to lab_open.)`,
        inputSchema: { type: "object", properties: { viewport: { type: "string" }, rotated: { type: "boolean" } }, additionalProperties: false },
        handler: (p, i) => {
            const patch = {};
            if (i?.viewport) {
                const v = i.viewport.toLowerCase();
                if (!(v in VIEWPORTS) && !/^\d{2,5}x\d{2,5}$/.test(v)) throw new GameLabError("bad_viewport", `Unknown viewport "${i.viewport}". Use ${Object.keys(VIEWPORTS).join(", ")} or WIDTHxHEIGHT.`);
                patch.viewport = v;
            }
            if (typeof i?.rotated === "boolean") patch.rotated = i.rotated;
            return p.setUi(patch);
        },
    },
    {
        name: "set_options",
        description: "Toggle auto-reload on file changes and/or cross-origin isolation headers (COOP/COEP; changing isolation reloads the game).",
        inputSchema: { type: "object", properties: { autoReload: { type: "boolean" }, isolation: { type: "boolean" } }, additionalProperties: false },
        handler: (p, i) => {
            const patch = {};
            if (typeof i?.autoReload === "boolean") patch.autoReload = i.autoReload;
            if (typeof i?.isolation === "boolean") patch.isolation = i.isolation;
            return p.setUi(patch);
        },
    },

    // ---- lab: Playwright-driven Chromium -----------------------------------
    {
        name: "lab_open",
        description: "Launch a real Chromium (Playwright) loading the game. Gives trusted input, device emulation (viewport/DPR/touch/UA), CPU & network throttling, Chrome performance traces, Playwright traces, video and HAR recording, and a virtual gamepad. Headed by default so the game gets a real GPU. Re-opening replaces the previous lab browser.",
        inputSchema: {
            type: "object",
            properties: {
                device: { type: "string", description: "Playwright device descriptor, e.g. 'iPhone 14', 'Pixel 7', 'iPad (gen 7)', 'Galaxy S9+', 'Desktop Chrome'. Sets viewport, DPR, touch, mobile UA." },
                width: { type: "integer", minimum: 200, maximum: 7680 }, height: { type: "integer", minimum: 200, maximum: 4320 },
                landscape: { type: "boolean", description: "Swap width/height when the device preset is portrait." },
                deviceScaleFactor: { type: "number", minimum: 0.5, maximum: 4 },
                touch: { type: "boolean", description: "Enable touch events (needed for touch/swipe)." },
                userAgent: { type: "string" },
                colorScheme: { type: "string", enum: ["light", "dark"] },
                locale: { type: "string" },
                headless: { type: "boolean", description: "Run without a window (software WebGL via SwiftShader; slower, deterministic). Default false." },
                video: { type: "boolean", description: "Record a .webm of the session (saved on lab_close). The screencast costs frames — don't combine with fps/hitch measurements." },
                har: { type: "boolean", description: "Record all network requests to a .har file (saved on lab_close)." },
                cpu: { type: "number", minimum: 1, maximum: 20, description: "CPU slowdown factor from the start (4 ≈ mid-range phone, 6 ≈ low-end)." },
                network: { type: ["string", "object"], description: `Network preset (${NETWORK_PRESET_NAMES.join(", ")}) or {downloadKbps, uploadKbps, latencyMs, offline}.` },
                timeoutMs: { type: "integer", description: "Page load timeout (default 60000)." },
            },
            additionalProperties: false,
        },
        handler: async (p, i) => { const lab = await p.labFor(); return labCall(() => lab.open(i ?? {})); },
    },
    {
        name: "lab_close",
        description: "Close the lab browser. Stops any running traces and returns paths of the video / HAR / trace artifacts.",
        inputSchema: noInput,
        handler: (p) => (p.lab ? labCall(() => p.lab.close()) : { running: false }),
    },
    {
        name: "lab_status",
        description: "Is the lab browser running, with which device/viewport/throttle, are traces recording, how many console errors, recent artifacts.",
        inputSchema: noInput,
        handler: (p) => (p.lab ? p.lab.status() : { running: false }),
    },
    {
        name: "touch",
        description: "Touch input in the lab browser (needs touch: true or a mobile device preset): tap, hold, or swipe between two points on the game canvas.",
        inputSchema: {
            type: "object",
            properties: {
                kind: { type: "string", enum: ["tap", "hold", "swipe"] },
                x: { type: "number" }, y: { type: "number" }, x2: { type: "number" }, y2: { type: "number" },
                unit: { type: "string", enum: ["px", "fraction"] },
                durationMs: { type: "integer", minimum: 0, maximum: 10000, description: "hold/swipe duration (default 250)." },
            },
            required: ["kind", "x", "y"],
            additionalProperties: false,
        },
        handler: (p, i) => labCall(() => p.requireLab().touch(i)),
    },
    {
        name: "gamepad",
        description: "Virtual gamepad in the lab browser (standard mapping, visible to navigator.getGamepads and gamepadconnected). action: connect | disconnect | reset | set. set takes buttons {a:1, rt:0.5, 12:1} (names a b x y lb rb lt rt back start ls rs up down left right home, or indices 0-16) and axes [lx, ly, rx, ry]; holdMs releases them afterwards.",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["connect", "disconnect", "reset", "set"] },
                index: { type: "integer", minimum: 0, maximum: 3 },
                buttons: { type: "object", additionalProperties: { type: ["number", "boolean"] } },
                axes: { type: "array", items: { type: ["number", "null"] }, maxItems: 4 },
                holdMs: { type: "integer", minimum: 0, maximum: 10000 },
            },
            additionalProperties: false,
        },
        handler: (p, i) => labCall(() => p.requireLab().gamepad(i ?? {})),
    },
    {
        name: "set_throttle",
        description: `Throttle the lab browser: cpu = slowdown factor 1-20 (1 = off; 4 ≈ mid-range phone), network = ${NETWORK_PRESET_NAMES.join(" | ")} or {downloadKbps, uploadKbps, latencyMs, offline}. Reload afterwards to measure load time under the new conditions.`,
        inputSchema: { type: "object", properties: { cpu: { type: "number", minimum: 1, maximum: 20 }, network: { type: ["string", "object"] } }, additionalProperties: false },
        handler: (p, i) => labCall(() => p.requireLab().setThrottle(i ?? {})),
    },
    {
        name: "trace_start",
        description: "Start recording in the lab browser. kind 'chrome' (default): Chrome performance trace (main-thread tasks, GC, frames, GPU) → .trace.json for Perfetto/DevTools, with a summary of long tasks on stop. kind 'playwright': Playwright trace with screenshots/actions → .pw.zip for `playwright show-trace`.",
        inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["chrome", "playwright"] }, name: { type: "string" }, screenshots: { type: "boolean", description: "playwright: capture screenshots (default true)." }, snapshots: { type: "boolean", description: "playwright: DOM snapshots (default false; heavy for wasm games)." } }, additionalProperties: false },
        handler: (p, i) => labCall(() => p.requireLab().traceStart(i?.kind ?? "chrome", i ?? {})),
    },
    {
        name: "trace_stop",
        description: "Stop a recording started with trace_start and write it to disk. Chrome traces return a summary (wall time, frames, long tasks > 50 ms, GC time, heaviest event types).",
        inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["chrome", "playwright"] } }, additionalProperties: false },
        handler: (p, i) => labCall(() => p.requireLab().traceStop(i?.kind ?? "chrome")),
    },

    // ---- scripted scenarios -------------------------------------------------
    {
        name: "run_scenario",
        description: `Run a scripted test scenario against the game and get a pass/fail report (also saved as JSON). Steps: ${STEP_KINDS.join(", ")}. Example: [{do:"waitFor", expr:"window.__gp.metrics().webgl.drawCallsTotal > 0"}, {do:"key", key:"ArrowUp", holdMs:1500}, {do:"expectFps", min:50}, {do:"expectNoErrors"}, {do:"expectNoHitches", max:2}, {do:"screenshot", name:"after-start"}]. Runs in the lab when open (target auto) so results match the exported Playwright test; tap/swipe/gamepad/throttle need the lab.`,
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string" },
                steps: { type: "array", items: STEP_SCHEMA, minItems: 1 },
                target: TARGET_PROP,
                stopOnFail: { type: "boolean", description: "Skip remaining steps after the first failure (default true)." },
                clearLogs: { type: "boolean", description: "Clear console before running (default true) so expectNoErrors only sees this run." },
                resetHitches: { type: "boolean", description: "Reset the hitch log before running (default true)." },
            },
            required: ["steps"],
            additionalProperties: false,
        },
        handler: async (p, i) => runScenario(p.driverFor(i.target ?? "auto"), i, { filesDir: await p.filesDir(), log: p.log }),
    },
    {
        name: "export_test",
        description: "Write a standalone Playwright project that replays a scenario in CI: tests/<name>.spec.ts, playwright.config.ts (with a webServer that serves the build with the same wasm/COOP/COEP headers), gp-serve.mjs, package.json. screenshot steps become toHaveScreenshot pixel-diff assertions. Existing files are kept unless overwrite is true.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string" },
                steps: { type: "array", items: STEP_SCHEMA, minItems: 1 },
                outDir: { type: "string", description: "Where to write the project (e.g. the game repo's tests/web folder). Default: <filesDir>/playwright." },
                device: { type: "string", description: "Playwright device to run under (default Desktop Chrome)." },
                viewport: { type: "string", description: "WIDTHxHEIGHT override." },
                port: { type: "integer", description: "Local port for the generated server (default 4173)." },
                overwrite: { type: "boolean" },
            },
            required: ["steps"],
            additionalProperties: false,
        },
        handler: async (p, i) => {
            const outDir = i.outDir ? expandHome(i.outDir) : path.join(await p.filesDir(), "playwright");
            const vp = i.viewport && /^(\d+)x(\d+)$/.exec(i.viewport);
            return exportTest({
                scenario: { name: i.name, steps: i.steps }, outDir, overwrite: !!i.overwrite, port: i.port,
                mode: p.mode, dir: p.dir, entry: p.entry, url: p.target?.href, isolation: p.ui.isolation,
                device: i.device, viewport: vp ? { width: Number(vp[1]), height: Number(vp[2]) } : undefined,
            });
        },
    },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Invoke a catalogue tool by name on a preview. */
export async function callTool(preview, name, input) {
    const tool = TOOLS_BY_NAME.get(name);
    if (!tool) throw new GameLabError("unknown_tool", `Unknown tool "${name}". Known: ${TOOLS.map((t) => t.name).join(", ")}`);
    return tool.handler(preview, input ?? {});
}
