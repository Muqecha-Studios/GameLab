// Turns a scenario (see scenario.mjs) into a standalone Playwright project:
// a *.spec.ts, a playwright.config.ts, and a tiny server (copies of
// server.mjs/hook.mjs) so CI serves the build exactly like the panel does.

import path from "node:path";
import { mkdir, writeFile, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GAMEPAD_SHIM } from "./lab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const q = (s) => JSON.stringify(s);
const exists = (p) => access(p).then(() => true, () => false);

export async function exportTest({ scenario, outDir, mode, dir, entry, url, isolation, viewport, device, profile, port = 4173, overwrite = false }) {
    const name = (scenario.name || "scenario").replace(/[^\w.-]+/g, "_");
    if (profile) {
        // A gamelab device profile maps onto the Playwright `use` block; CPU/network throttling become a leading step.
        device ??= profile.pw;
        viewport ??= { width: profile.width, height: profile.height };
        const throttle = {};
        if (profile.cpu > 1) throttle.cpu = profile.cpu;
        if (profile.network && profile.network !== "none" && profile.network !== "wifi") throttle.network = profile.network;
        if (Object.keys(throttle).length) scenario = { ...scenario, steps: [{ do: "throttle", ...throttle }, ...scenario.steps] };
    }
    const testsDir = path.join(outDir, "tests");
    await mkdir(testsDir, { recursive: true });
    const written = [], skipped = [];
    const write = async (rel, content, { force = false } = {}) => {
        const file = path.join(outDir, rel);
        if (!force && !overwrite && (await exists(file))) { skipped.push(file); return; }
        await writeFile(file, content);
        written.push(file);
    };

    const usesTouch = scenario.steps.some((s) => s.do === "tap" || s.do === "swipe");
    const usesGamepad = scenario.steps.some((s) => s.do === "gamepad");
    const usesCdp = scenario.steps.some((s) => s.do === "throttle" || s.do === "swipe");
    const gamePath = mode === "dir" ? "/" + entry.split(path.sep).map(encodeURIComponent).join("/") : new URL(url).pathname + new URL(url).search;
    const baseURL = mode === "dir" ? `http://127.0.0.1:${port}` : new URL(url).origin;

    await write(`tests/${name}.spec.ts`, renderSpec({ name, scenario, gamePath, usesTouch, usesGamepad, usesCdp }), { force: overwrite });
    if (usesGamepad) await write("tests/gp-gamepad.ts", `// Virtual Gamepad API shim (same one the gamelab lab installs).\nexport const GAMEPAD_SHIM = ${q(GAMEPAD_SHIM)};\n`);
    await write("playwright.config.ts", renderConfig({ mode, dir, port, baseURL, gamePath, isolation, viewport, device, usesTouch: usesTouch || !!profile?.touch, profile }));
    if (mode === "dir") {
        await write("gp-serve.mjs", SERVE_SCRIPT);
        for (const f of ["server.mjs", "hook.mjs"]) {
            const dest = path.join(outDir, f);
            if (overwrite || !(await exists(dest))) { await copyFile(path.join(here, f), dest); written.push(dest); } else skipped.push(dest);
        }
    }
    await write("package.json", JSON.stringify({ name: `${name}-web-tests`, private: true, type: "module", scripts: { test: "playwright test", "test:headed": "playwright test --headed", "test:update": "playwright test --update-snapshots", report: "playwright show-report" }, devDependencies: { "@playwright/test": "^1.50.0" } }, null, 2) + "\n");
    await write(".gitignore", "node_modules/\ntest-results/\nplaywright-report/\n");

    return {
        outDir, written, skipped,
        next: [
            `cd ${q(outDir)} && npm install && npx playwright install chromium`,
            "npx playwright test            # headless (SwiftShader WebGL)",
            "npx playwright test --headed   # real GPU",
            "npx playwright test --update-snapshots   # accept screenshot baselines the first time",
            "GP_RECORD=1 npx playwright test          # keep video + trace on failure (costs frames; avoid for fps assertions)",
            "npx playwright show-report",
        ],
    };
}

const STATE_CODE = (expr) => `await (async () => { const g = await window.__gp.gameState(); if (!g.present) throw new Error("no game probe"); const state = g.state ?? {}, metrics = g.metrics ?? {}, events = g.events?.recent ?? []; return (${expr}\n); })()`;

function renderSpec({ name, scenario, gamePath, usesTouch, usesGamepad, usesCdp }) {
    const lines = [];
    const L = (s = "") => lines.push(s ? "    " + s : "");
    for (const [i, s] of scenario.steps.entries()) {
        const note = s.note ? ` — ${s.note}` : "";
        L(`// step ${i}: ${s.do}${note}`);
        switch (s.do) {
            case "wait": L(`await page.waitForTimeout(${s.ms ?? 500});`); break;
            case "waitFor": L(`await page.waitForFunction(${q(s.expr)}, undefined, { timeout: ${s.timeoutMs ?? 10000} });`); break;
            case "key": {
                const mods = [s.shift && "Shift", s.ctrl && "Control", s.alt && "Alt", s.meta && "Meta"].filter(Boolean);
                const times = s.times ?? 1;
                if (times > 1) L(`for (let k = 0; k < ${times}; k++) {`);
                const ind = times > 1 ? "    " : "";
                for (const m of mods) L(`${ind}await page.keyboard.down(${q(m)});`);
                L(`${ind}await page.keyboard.down(${q(s.key)});`);
                L(`${ind}await page.waitForTimeout(${s.holdMs ?? 100});`);
                L(`${ind}await page.keyboard.up(${q(s.key)});`);
                for (const m of mods.reverse()) L(`${ind}await page.keyboard.up(${q(m)});`);
                if (times > 1) { L(`    await page.waitForTimeout(${s.gapMs ?? 50});`); L("}"); }
                break;
            }
            case "click": L(`await clickCanvas(page, ${s.x}, ${s.y}, ${q(s.unit ?? "px")}, ${s.holdMs ?? 60});`); break;
            case "tap": L(`await tapCanvas(page, ${s.x}, ${s.y}, ${q(s.unit ?? "px")});`); break;
            case "swipe": L(`await swipeCanvas(page, ${s.x}, ${s.y}, ${s.x2}, ${s.y2}, ${q(s.unit ?? "px")}, ${s.durationMs ?? 250});`); break;
            case "gamepad":
                if (s.action === "connect") L(`await page.evaluate((i) => (window as any).__gpPad.connect(i), ${s.index ?? 0});`);
                else if (s.action === "disconnect") L(`await page.evaluate((i) => (window as any).__gpPad.disconnect(i), ${s.index ?? 0});`);
                else {
                    L(`await page.evaluate(([i, st]) => (window as any).__gpPad.set(i, st), [${s.index ?? 0}, ${q({ buttons: s.buttons ?? {}, axes: s.axes })}] as const);`);
                    if (s.holdMs) { L(`await page.waitForTimeout(${s.holdMs});`); L(`await page.evaluate((i) => (window as any).__gpPad.reset(i), ${s.index ?? 0});`); }
                }
                break;
            case "eval": L(`await evalGame(page, ${q(s.code)});`); break;
            case "waitForState": L(`await page.waitForFunction(${q(`(async () => { try { return ${STATE_CODE(s.expr)} } catch { return false; } })()`)}, undefined, { timeout: ${s.timeoutMs ?? 10000}, polling: ${s.intervalMs ?? 100} });`); break;
            case "assertState": L(`expect(await evalGame(page, ${q(STATE_CODE(s.expr))}), ${q(s.message || `assertState: ${s.expr}`)}).toBeTruthy();`); break;
            case "gameCommand": L(`await evalGame(page, ${q(`window.__gp.gameCommand(${JSON.stringify(s.name)}, ${JSON.stringify(s.args ?? null)})`)});`); break;
            case "waitForEvent":
                L(`{ const since = (await evalGame(page, "(await window.__gp.gameState()).events.total")) as number;`);
                L(`  await page.waitForFunction(([n, since]) => (window as any).__gp.gameState().then((g: any) => g.events.recent.slice(Math.max(0, g.events.recent.length - (g.events.total - since))).some((e: any) => e.name === n)), [${q(s.event)}, since] as const, { timeout: ${s.timeoutMs ?? 10000}, polling: ${s.intervalMs ?? 100} });`);
                L(`}`);
                break;
            case "assert": L(`expect(await evalGame(page, ${q(s.expr)}), ${q(s.message || `assert: ${s.expr}`)}).toBeTruthy();`); break;
            case "expectFps": L(`expect(await fpsOver(page, ${s.sampleMs ?? 2000}), "average fps").toBeGreaterThanOrEqual(${s.min});`); break;
            case "expectNoErrors": L(`expect(errors, "console errors").toEqual([]);`); break;
            case "expectNoHitches":
                L(`{ const m = await metrics(page);`);
                L(`  expect(m.hitches.count, \`frame hitches: \${JSON.stringify(m.hitches.recent.slice(-3))}\`).toBeLessThanOrEqual(${s.max ?? 0});`);
                if (s.maxFrameMs) L(`  expect(m.frame.maxMs, "worst frame ms").toBeLessThanOrEqual(${s.maxFrameMs});`);
                L(`}`);
                break;
            case "screenshot": L(`await expect(page).toHaveScreenshot(${q((s.name || `${name}-step${i}`) + ".png")}, { maxDiffPixelRatio: 0.02 });`); break;
            case "reload": L(`await page.reload({ waitUntil: "load" }); errors.length = 0; await page.waitForFunction(() => !!(window as any).__gp);`); break;
            case "throttle":
                if (s.cpu !== undefined) L(`await cdp.send("Emulation.setCPUThrottlingRate", { rate: ${s.cpu} });`);
                if (s.network !== undefined) L(`await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", ${q(networkCondition(s.network))});`);
                break;
            case "visibility": L(`await page.evaluate((h) => (window as any).__gp.setVisibility(h), ${s.hidden ?? null});`); break;
            case "loseContext": L(`await page.evaluate((ms) => (window as any).__gp.loseContext(ms), ${s.restoreAfterMs ?? 1000});`); break;
            case "reset": L(`errors.length = 0; await page.evaluate(() => (window as any).__gp.resetHitches());`); break;
            default: L(`// (unsupported step ${q(s.do)})`);
        }
    }

    return `// Generated by gamelab from scenario "${scenario.name || name}".
// Run: npx playwright test ${name}   (add --headed for a real GPU)
import { test, expect, type Page } from "@playwright/test";
${usesGamepad ? 'import { GAMEPAD_SHIM } from "./gp-gamepad";\n' : ""}
const GAME = process.env.GAME_PATH ?? ${q(gamePath)};

async function canvasBox(page: Page) {
    return page.evaluate(() => {
        const list = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height);
        const r = (list[0] || document.body).getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
}
async function toPoint(page: Page, x: number, y: number, unit: string) {
    const b = await canvasBox(page);
    return unit === "fraction" ? { x: b.x + x * b.width, y: b.y + y * b.height } : { x: b.x + x, y: b.y + y };
}
async function clickCanvas(page: Page, x: number, y: number, unit: string, holdMs: number) {
    const p = await toPoint(page, x, y, unit);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(holdMs); await page.mouse.up();
}
${usesTouch ? `async function tapCanvas(page: Page, x: number, y: number, unit: string) {
    const p = await toPoint(page, x, y, unit);
    await page.touchscreen.tap(p.x, p.y);
}
async function swipeCanvas(page: Page, x: number, y: number, x2: number, y2: number, unit: string, durationMs: number) {
    const from = await toPoint(page, x, y, unit), to = await toPoint(page, x2, y2, unit);
    const cdp = await page.context().newCDPSession(page);
    const tp = (pt: { x: number; y: number }) => ({ x: pt.x, y: pt.y, radiusX: 4, radiusY: 4, force: 1, id: 1 });
    const steps = 12;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tp(from)] });
    for (let i = 1; i <= steps; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [tp({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps })] });
        await page.waitForTimeout(durationMs / steps);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
` : ""}async function evalGame(page: Page, code: string) {
    return page.evaluate(async (src) => {
        const AF = Object.getPrototypeOf(async function () {}).constructor;
        let fn: () => Promise<unknown>;
        try { fn = new AF("return (" + src + "\\n)"); } catch { fn = new AF(src); }
        const v = await fn();
        try { JSON.stringify(v); return v; } catch { return String(v); }
    }, code);
}
async function fpsOver(page: Page, ms: number): Promise<number> {
    return page.evaluate((ms) => new Promise<number>((resolve) => {
        let n = 0; const start = performance.now();
        requestAnimationFrame(function f(t) { n++; if (t - start < ms) requestAnimationFrame(f); else resolve(Math.round((n * 1000) / (t - start))); });
    }), ms);
}
async function metrics(page: Page) {
    return page.evaluate(() => (window as any).__gp.metrics());
}

test(${q(scenario.name || name)}, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
${usesGamepad ? "    await page.addInitScript(GAMEPAD_SHIM);\n" : ""}${usesCdp ? "    const cdp = await page.context().newCDPSession(page);\n" : ""}
    await page.goto(GAME, { waitUntil: "load" });
    await page.waitForFunction(() => !!(window as any).__gp, undefined, { timeout: 60000 }); // gamelab hook injected by gp-serve
    await page.evaluate(() => (window as any).__gp.resetHitches());

${lines.join("\n")}
});
`;
}

function networkCondition(network) {
    const presets = {
        offline: { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 },
        "slow-3g": { offline: false, downloadThroughput: 51200, uploadThroughput: 51200, latency: 2000 },
        "fast-3g": { offline: false, downloadThroughput: 209715, uploadThroughput: 96000, latency: 562 },
        "4g": { offline: false, downloadThroughput: 1179648, uploadThroughput: 196608, latency: 60 },
        wifi: { offline: false, downloadThroughput: 3932160, uploadThroughput: 1966080, latency: 2 },
        none: { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 },
    };
    if (typeof network === "string") return presets[network] ?? presets.none;
    return { offline: !!network.offline, downloadThroughput: network.downloadKbps ? (network.downloadKbps * 1024) / 8 : -1, uploadThroughput: network.uploadKbps ? (network.uploadKbps * 1024) / 8 : -1, latency: network.latencyMs ?? 0 };
}

function renderConfig({ mode, dir, port, baseURL, gamePath, isolation, viewport, device, usesTouch, profile }) {
    const use = [];
    if (device) use.push(`...devices[${q(device)}],`);
    else use.push(`...devices["Desktop Chrome"],`);
    if (profile) use.push(`// gamelab device profile "${profile.name}" (${profile.id})`);
    if (viewport) use.push(`viewport: { width: ${viewport.width}, height: ${viewport.height} },`);
    if (profile?.dpr) use.push(`deviceScaleFactor: ${profile.dpr},`);
    if (profile?.mobile) use.push("isMobile: true,");
    if (profile?.ua) use.push(`userAgent: ${q(profile.ua)},`);
    if (usesTouch) use.push("hasTouch: true,");
    return `// Generated by gamelab. Serves the build with the same headers the lab uses (wasm/br/gz MIME, COOP/COEP).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    timeout: 180_000,
    retries: process.env.CI ? 1 : 0,
    reporter: [["list"], ["html", { open: "never" }]],
    expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "allow" } },
    use: {
        baseURL: ${q(baseURL)},
        ${use.join("\n        ")}
        // Video/trace capture uses a screencast that costs frames and skews fps/hitch assertions. Opt in: GP_RECORD=1 npx playwright test
        trace: process.env.GP_RECORD ? "retain-on-failure" : "off",
        video: process.env.GP_RECORD ? "retain-on-failure" : "off",
        // Headless Chromium has no GPU: allow SwiftShader so WebGL still works. --headed uses the real GPU.
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--enable-features=SharedArrayBuffer", ...(process.argv.includes("--headed") ? [] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])] },
    },
${mode === "dir" ? `    webServer: {
        command: \`node gp-serve.mjs ${q(dir)} ${port} ${isolation ? "on" : "off"}\`,
        url: ${q(`${baseURL}${gamePath}`)},
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
` : `    // url mode: start your dev server (${baseURL}) before running tests, or add a webServer entry here.
`}});
`;
}

const SERVE_SCRIPT = `// Minimal static server for web game builds (copy of the gamelab server).
// usage: node gp-serve.mjs <dir> [port=4173] [isolation=auto|on|off]
import { createServer } from "node:http";
import path from "node:path";
import { serveStatic, looksLikeWasmExport, HOOK_PATH } from "./server.mjs";
import { HOOK_JS } from "./hook.mjs";

const [dirArg, portArg = "4173", isoArg = "auto"] = process.argv.slice(2);
if (!dirArg) { console.error("usage: node gp-serve.mjs <dir> [port] [isolation]"); process.exit(2); }
const dir = path.resolve(dirArg);
const isolation = isoArg === "on" ? true : isoArg === "off" ? false : await looksLikeWasmExport(dir);

createServer(async (req, res) => {
    try {
        if (new URL(req.url, "http://x").pathname === HOOK_PATH) {
            res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
            return res.end(HOOK_JS);
        }
        await serveStatic(req, res, { dir, isolation });
    } catch (err) {
        if (!res.headersSent) { res.writeHead(500); res.end(String(err?.message ?? err)); }
    }
}).listen(Number(portArg), "127.0.0.1", () => console.log(\`gp-serve: \${dir} → http://127.0.0.1:\${portArg}\${isolation ? " (COOP/COEP on)" : ""}\`));
`;
