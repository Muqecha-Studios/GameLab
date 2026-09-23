// Preview: one served/proxied web game with an instrumented hook, an optional
// attached browser "panel" (the shell UI opened in any browser or embedded
// in a host like the Copilot canvas) and an optional Playwright "lab".
//
// Harness-agnostic: no host SDK here. Hosts (MCP server, CLI, Copilot canvas)
// construct a Preview via openPreview() and call tools from tools.mjs on it.

import { createServer } from "node:http";
import { watch } from "node:fs";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { HOOK_JS } from "./hook.mjs";
import { renderShell } from "./shell.mjs";
import { VIEWPORTS, allDevices, resolveDevice, upsertUserDevice, deleteUserDevice, emulationFor, labOptionsFor, GROUP_LABELS, USER_DEVICES_PATH } from "./devices.mjs";
import { HOOK_PATH, serveStatic, proxyRequest, proxyUpgrade, detectEntry, looksLikeWasmExport, applyIsolation } from "./server.mjs";
import { Lab } from "./lab.mjs";

export const SHELL_PREFIX = "/__gp/";
export const CMD_TIMEOUT_MS = 15000;
export { VIEWPORTS };

/** Error with a stable machine-readable `code`; hosts map it to their own error type. */
export class GameLabError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "GameLabError";
        this.code = code;
    }
}

export function expandHome(p) {
    return path.resolve(p.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
}

function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(e); } });
        req.on("error", reject);
    });
}

/**
 * Turn user input ({url} | {dir, entry}, watch, isolation, viewport, title)
 * into a normalized config. `cwd` is used to auto-detect a build folder when
 * neither url nor dir is given.
 */
export async function resolveConfig(input = {}, { cwd } = {}) {
    const cfg = { isolationMode: input.isolation ?? "auto", viewport: input.viewport ?? "fill", device: input.device ?? null, title: input.title, autoReload: input.watch !== false };

    if (input.url) {
        let target;
        try { target = new URL(input.url); } catch { throw new GameLabError("bad_url", `Invalid url: ${input.url}`); }
        if (target.protocol !== "http:") throw new GameLabError("bad_url", "Only http:// dev server URLs can be proxied (https is not supported).");
        cfg.mode = "url";
        cfg.target = target;
        cfg.gameSrc = target.pathname + target.search;
        cfg.source = target.origin + (target.pathname !== "/" ? target.pathname : "");
        cfg.watchDir = typeof input.watch === "string" ? expandHome(input.watch) : null;
        cfg.key = `url:${target.href}`;
        return cfg;
    }

    let dir = input.dir ? expandHome(input.dir) : null;
    if (!dir) {
        for (const candidate of cwd ? [cwd, path.join(cwd, "dist"), path.join(cwd, "build"), path.join(cwd, "builds", "web"), path.join(cwd, "export", "web"), path.join(cwd, "public")] : []) {
            try { if (await detectEntry(candidate)) { dir = candidate; break; } } catch { /* skip */ }
        }
        if (!dir) throw new GameLabError("no_source", "Pass either `url` (a running dev server, e.g. http://localhost:5173/) or `dir` (a folder containing a built web game with an .html entry).");
    }
    try {
        if (!(await stat(dir)).isDirectory()) throw new Error("not a directory");
    } catch { throw new GameLabError("bad_dir", `Directory not found: ${dir}`); }

    const entry = input.entry ?? (await detectEntry(dir));
    if (!entry) throw new GameLabError("no_entry", `No .html entry found in ${dir}. Pass \`entry\` explicitly.`);
    cfg.mode = "dir";
    cfg.dir = dir;
    cfg.entry = entry;
    cfg.gameSrc = "/" + entry.split(path.sep).map(encodeURIComponent).join("/");
    cfg.source = dir;
    cfg.watchDir = typeof input.watch === "string" ? expandHome(input.watch) : input.watch === false ? null : dir;
    cfg.key = `dir:${dir}:${entry}`;
    return cfg;
}

export class Preview {
    /**
     * @param {object} cfg from resolveConfig()
     * @param {object} opts
     * @param {string} opts.id            host-chosen instance id
     * @param {string} opts.filesDir      where screenshots/reports/traces go
     * @param {(msg:string, level?:string)=>void} [opts.log]
     * @param {"panel"|"lab"|"auto"} [opts.defaultTarget="panel"] target used by play tools when none is given
     * @param {number} [opts.port=0]      0 = random loopback port
     */
    constructor(cfg, { id, filesDir, log, defaultTarget = "panel", port = 0 } = {}) {
        this.id = id ?? randomUUID().slice(0, 8);
        this.key = cfg.key;
        this.mode = cfg.mode;
        this.dir = cfg.dir;
        this.entry = cfg.entry;
        this.target = cfg.target;
        this.watchDir = cfg.watchDir;
        this.watcher = null;
        this.title = cfg.title || (cfg.mode === "dir" ? `Game · ${path.basename(cfg.dir)}` : `Game · ${cfg.target.host}`);
        this.source = cfg.source;
        this.gameSrc = cfg.gameSrc;
        this.clients = new Set();
        this.pending = new Map();
        this.lab = null;
        this.ui = { viewport: cfg.viewport.toLowerCase(), rotated: false, autoReload: cfg.autoReload, isolation: false, device: null, emulation: null };
        this._initialDevice = cfg.device ?? null;
        this._isolationMode = cfg.isolationMode;
        this._filesDir = filesDir ?? path.join(os.tmpdir(), "gamelab");
        this.log = log ?? (() => {});
        this.defaultTarget = defaultTarget;
        this._port = port;
        this.server = null;
        this.url = null;
    }

    /** Shell (panel UI) URL — open it in any browser to watch and play. */
    get shellUrl() { return `${this.url}${SHELL_PREFIX}`; }
    /** Direct game URL (hook injected, no shell chrome). What the lab loads. */
    get gameUrl() { return `${this.url}${this.gameSrc}`; }
    get status() { return this.mode === "dir" ? this.entry : this.target.host; }

    async filesDir() {
        await mkdir(this._filesDir, { recursive: true });
        return this._filesDir;
    }

    async start() {
        this.ui.isolation = this._isolationMode === "on" ? true : this._isolationMode === "off" ? false : this.mode === "dir" && (await looksLikeWasmExport(this.dir));
        if (this._initialDevice) await this.setDevice(this._initialDevice);
        const server = createServer(async (req, res) => {
            const url = new URL(req.url, "http://127.0.0.1");
            try {
                if (url.pathname.startsWith(SHELL_PREFIX)) return await this._handleShell(url, req, res);
                if (this.mode === "dir") return await serveStatic(req, res, { dir: this.dir, isolation: this.ui.isolation });
                return proxyRequest(req, res, { target: this.target, isolation: this.ui.isolation });
            } catch (err) {
                if (!res.headersSent) json(res, 500, { error: String(err?.message ?? err) });
                else res.destroy();
            }
        });
        server.on("upgrade", (req, socket, head) => {
            if (this.mode !== "url") return socket.destroy();
            proxyUpgrade(req, socket, head, { target: this.target });
        });
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(this._port, "127.0.0.1", resolve); });
        const address = server.address();
        this.server = server;
        this.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
        this._startWatcher();
        this.log(`gamelab: ${this.mode === "dir" ? `serving ${this.dir} (${this.entry})` : `proxying ${this.target.origin}`} at ${this.url}${this.ui.isolation ? " · isolated" : ""}`);
        return this;
    }

    async close() {
        this.watcher?.close();
        if (this.lab) { try { await this.lab.close(); } catch { /* ignore */ } }
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new GameLabError("closed", "Preview closed")); }
        for (const res of this.clients) { try { res.end(); } catch { /* ignore */ } }
        if (this.server) await new Promise((resolve) => this.server.close(() => resolve()));
        this.server = null;
    }

    info() {
        return {
            id: this.id, title: this.title, mode: this.mode, source: this.source, entry: this.entry,
            url: this.shellUrl, gameUrl: this.gameUrl, isolation: this.ui.isolation, device: this.ui.device, ui: this.ui,
            panelConnected: this.clients.size > 0, labRunning: !!this.lab?.running, filesDir: this._filesDir,
        };
    }

    // ---- panel bridge (SSE to the shell, results back over HTTP) ------------

    broadcast(event, payload) {
        const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
        for (const res of this.clients) {
            try { res.write(data); } catch { this.clients.delete(res); }
        }
    }

    setUi(patch) {
        Object.assign(this.ui, patch);
        this.broadcast("state", patch);
        return this.ui;
    }

    /**
     * Select a device profile (id or name) for the panel: sets the viewport to
     * its resolution and the emulation the hook applies on the next reload.
     * `null` clears the profile and returns to "fill".
     */
    async setDevice(idOrName, extra = {}) {
        if (idOrName === null) return this.setUi({ ...extra, device: null, emulation: null, viewport: extra.viewport ?? "fill" });
        const d = await resolveDevice(idOrName);
        if (!d) throw new GameLabError("bad_device", `Unknown device profile "${idOrName}". Use list_devices to see the seeded and user profiles.`);
        const rotated = extra.rotated ?? this.ui.rotated;
        return this.setUi({ ...extra, device: d.id, viewport: `${d.width}x${d.height}`, emulation: emulationFor(d, { rotated }) });
    }

    /** Send a command to the shell (or the game via the shell) and await its result. */
    command(target, cmd, timeoutMs = CMD_TIMEOUT_MS) {
        if (this.clients.size === 0) {
            throw new GameLabError("not_connected", `No browser is attached to the panel. Open ${this.shellUrl} in a browser (or re-open the host panel), or use lab_open and target "lab".`);
        }
        const id = randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new GameLabError("timeout", `No response from the ${target === "game" ? "game page" : "preview panel"} within ${timeoutMs / 1000}s. ${target === "game" ? "Is the game loaded and the hook injected? Check get_logs for a 'hook did not run' note." : ""}`.trim()));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.broadcast("cmd", { id, target, ...cmd });
        });
    }

    async _handleShell(url, req, res) {
        const route = url.pathname.slice(SHELL_PREFIX.length);
        if (route === "" || route === "index.html") {
            const headers = applyIsolation({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }, this.ui.isolation);
            res.writeHead(200, headers);
            return res.end(renderShell({ title: this.title, source: this.source, gameSrc: this.gameSrc, isolation: this.ui.isolation }));
        }
        if (url.pathname === HOOK_PATH) {
            res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
            return res.end(`window.__gpEmu = ${JSON.stringify(this.ui.emulation)};\n` + HOOK_JS);
        }
        if (route === "events") {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
            res.write(`event: state\ndata: ${JSON.stringify(this.ui)}\n\n`);
            this.clients.add(res);
            const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* ignore */ } }, 20000);
            req.on("close", () => { clearInterval(ping); this.clients.delete(res); });
            return;
        }
        if (route === "api/state" && req.method === "POST") {
            const patch = await readBody(req);
            const allowed = {};
            if (typeof patch.viewport === "string") allowed.viewport = patch.viewport;
            if (typeof patch.rotated === "boolean") allowed.rotated = patch.rotated;
            if (typeof patch.autoReload === "boolean") allowed.autoReload = patch.autoReload;
            if (typeof patch.isolation === "boolean") allowed.isolation = patch.isolation;
            if (patch.device === null || typeof patch.device === "string") {
                try { return json(res, 200, await this.setDevice(patch.device, allowed)); } catch (err) { return json(res, 400, { error: err.message }); }
            }
            if (allowed.viewport !== undefined && this.ui.device) { allowed.device = null; allowed.emulation = null; }
            if (allowed.rotated !== undefined && this.ui.device) { const d = await resolveDevice(this.ui.device); if (d) allowed.emulation = emulationFor(d, { rotated: allowed.rotated }); }
            return json(res, 200, this.setUi(allowed));
        }
        if (route === "api/devices") {
            if (req.method === "GET") return json(res, 200, { devices: await allDevices(), groups: GROUP_LABELS, userFile: USER_DEVICES_PATH().replace(process.env.HOME || "\0", "~") });
            try {
                if (req.method === "POST") { const d = await upsertUserDevice(await readBody(req)); if (this.ui.device === d.id) await this.setDevice(d.id); return json(res, 200, { saved: d, devices: await allDevices() }); }
                if (req.method === "DELETE") { const id = url.searchParams.get("id"); const removed = await deleteUserDevice(id); if (this.ui.device === id) await this.setDevice((await resolveDevice(id)) ? id : null); return json(res, 200, { removed, devices: await allDevices() }); }
            } catch (err) { return json(res, 400, { error: err.message }); }
        }
        if (route === "api/lab/open" && req.method === "POST") {
            const body = await readBody(req);
            try {
                const d = body.device ? await resolveDevice(body.device) : null;
                if (body.device && !d) return json(res, 400, { error: `Unknown device "${body.device}"` });
                const lab = await this.labFor();
                const r = await lab.open({ ...labOptionsFor(d, { landscape: !!body.landscape }), headless: false });
                return json(res, 200, r);
            } catch (err) { return json(res, 500, { error: err.message }); }
        }
        if (route === "api/result" && req.method === "POST") {
            const body = await readBody(req);
            const p = this.pending.get(body.id);
            if (p) {
                this.pending.delete(body.id);
                clearTimeout(p.timer);
                if (body.ok) p.resolve(body.value);
                else p.reject(new GameLabError("command_failed", body.error || "Command failed"));
            }
            return json(res, 200, { ok: true });
        }
        if (route === "api/info") return json(res, 200, this.info());
        res.writeHead(404); res.end("not found");
    }

    _startWatcher() {
        if (!this.watchDir) return;
        let timer = null;
        let reasons = new Set();
        try {
            this.watcher = watch(this.watchDir, { recursive: true }, (_event, name) => {
                if (!name || /(^|[\\/])\./.test(name)) return;
                reasons.add(String(name));
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const list = [...reasons].slice(0, 3).join(", ") + (reasons.size > 3 ? ` +${reasons.size - 3}` : "");
                    reasons = new Set();
                    if (this.ui.autoReload) this.broadcast("reload", { reason: list });
                    else this.broadcast("hint", { text: `— files changed (${list}); auto-reload is off —` });
                }, 350);
            });
            this.watcher.on("error", (err) => this.log(`gamelab: watcher error: ${err.message}`, "warning"));
        } catch (err) {
            this.log(`gamelab: cannot watch ${this.watchDir}: ${err.message}`, "warning");
        }
    }

    // ---- lab -----------------------------------------------------------------

    requireLab() {
        if (!this.lab?.running) throw new GameLabError("lab_not_running", "The lab browser is not running. Call lab_open first (it launches a Playwright-driven Chromium).");
        return this.lab;
    }

    async labFor() {
        this.lab ??= new Lab({ baseUrl: this.url, gamePath: this.gameSrc, filesDir: await this.filesDir(), log: this.log });
        return this.lab;
    }

    // ---- drivers --------------------------------------------------------------

    async saveCanvasShot(name) {
        const shot = await this.command("game", { kind: "screenshot" }, 20000);
        const m = /^data:image\/png;base64,(.+)$/.exec(shot?.dataUrl ?? "");
        if (!m) throw new GameLabError("screenshot_failed", "Canvas returned no PNG data (tainted canvas or WebGL context lost?).");
        const dir = await this.filesDir();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const file = path.join(dir, `${(name || "shot").replace(/[^\w.-]+/g, "_")}-${stamp}.png`);
        await writeFile(file, Buffer.from(m[1], "base64"));
        return { path: file, width: shot.width, height: shot.height, hint: "Open `path` to look at the frame." };
    }

    panelDriver() {
        const game = (cmd, t) => this.command("game", cmd, t);
        return {
            name: "panel",
            wait: (ms) => new Promise((r) => setTimeout(r, ms)),
            key: (o) => game({ kind: "key", ...o }, (o.holdMs ?? 100) + CMD_TIMEOUT_MS),
            click: (o) => game({ kind: "click", ...o }),
            evaluate: (code, t) => game({ kind: "eval", code }, t ?? CMD_TIMEOUT_MS),
            screenshot: (name) => this.saveCanvasShot(name),
            getLogs: (opts) => this.command("shell", { kind: "get_logs", ...opts }),
            errorLogs: async () => (await this.command("shell", { kind: "get_logs", level: "error", limit: 50 }))?.entries ?? [],
            clearLogs: () => this.command("shell", { kind: "clear_logs" }),
            stats: () => this.command("shell", { kind: "get_stats" }),
            metrics: () => game({ kind: "metrics" }),
            loadTimeline: () => game({ kind: "load_timeline" }),
            resetHitches: () => game({ kind: "reset_hitches" }),
            visibility: (hidden) => game({ kind: "visibility", hidden }),
            loseContext: (ms) => game({ kind: "lose_context", restoreAfterMs: ms }, (ms ?? 0) + CMD_TIMEOUT_MS),
            profile: (ms) => game({ kind: "profile", durationMs: ms }, (ms ?? 5000) + CMD_TIMEOUT_MS),
            gameState: () => game({ kind: "game_state" }),
            gameCommand: (name, args) => game({ kind: "game_command", name, args }),
            reload: () => this.command("shell", { kind: "reload" }),
        };
    }

    labDriver(lab = this.requireLab()) {
        const w = (fn) => (...a) => labCall(() => fn(...a));
        return {
            name: "lab",
            wait: (ms) => new Promise((r) => setTimeout(r, ms)),
            key: w((o) => lab.pressKey(o)),
            click: w((o) => lab.click(o)),
            touch: w((o) => lab.touch(o)),
            gamepad: w((o) => lab.gamepad(o)),
            evaluate: w((code, t) => lab.evaluate(code, t)),
            screenshot: w((name) => lab.screenshot(name)),
            getLogs: async (opts) => lab.getLogs(opts),
            errorLogs: async () => lab.getLogs({ level: "error", limit: 50 }).entries,
            clearLogs: async () => { lab.logs = []; },
            stats: w(async () => ({ target: "lab", ...(await lab.hookCall("window.__gp.metrics()")) })),
            metrics: w(() => lab.hookCall("window.__gp.metrics()")),
            loadTimeline: w(() => lab.hookCall("window.__gp.loadTimeline()")),
            resetHitches: w(() => lab.hookCall("window.__gp.resetHitches()")),
            visibility: w((hidden) => lab.setVisibility(hidden)),
            loseContext: w((ms) => lab.hookCall(`window.__gp.loseContext(${ms ?? "null"})`)),
            profile: w((ms) => lab.hookCall(`window.__gp.profile(${ms ?? 5000})`)),
            gameState: w(() => lab.hookCall("window.__gp.gameState()")),
            gameCommand: w((name, args) => lab.hookCall(`window.__gp.gameCommand(${JSON.stringify(name)}, ${JSON.stringify(args ?? null)})`)),
            reload: w(() => lab.reload()),
            throttle: w((o) => lab.setThrottle(o)),
        };
    }

    /** Pick the driver for a `target`: panel | lab | auto (lab when running, else panel). */
    driverFor(target = this.defaultTarget) {
        if (target === "lab") return this.labDriver();
        if (target === "auto" && this.lab?.running) return this.labDriver(this.lab);
        return this.panelDriver();
    }
}

/** Wrap a Lab error so callers see a clean, single-line message. */
export async function labCall(fn) {
    try { return await fn(); } catch (err) {
        if (err instanceof GameLabError) throw err;
        throw new GameLabError("lab_error", String(err?.message ?? err).split("\n")[0]);
    }
}

/** Resolve input, create and start a Preview. */
export async function openPreview(input, opts = {}) {
    const cfg = await resolveConfig(input, { cwd: opts.cwd });
    return new Preview(cfg, opts).start();
}
