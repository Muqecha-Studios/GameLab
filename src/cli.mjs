// CLI: gamelab serve | run | export | mcp | tools | config
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { openPreview, GameLabError } from "./preview.mjs";
import { TOOLS, callTool } from "./tools.mjs";

const { version } = createRequire(import.meta.url)("../package.json");

const HELP = `gamelab v${version} — test lab for HTML5/WebGL games (Godot, Unity, Phaser, PixiJS, Three.js …)

Usage:
  gamelab serve  [dir|url] [--isolation auto|on|off] [--port N] [--out DIR] [--no-watch] [--open] [--profile ID]
      Serve a build (or proxy a dev server) with the hook injected; prints the shell URL.
      The shell (any browser tab) shows FPS, console, and a Perf tab: frame times, hitches,
      WebGL counters, load timeline, findings, and a CPU profile of hot functions. --open launches it.
  gamelab run    <scenario.json> [dir|url] [--profile budget-android] [--device "iPhone 14"] [--landscape]
                 [--cpu 4] [--network slow-3g] [--headless] [--width W --height H] [--video] [--har]
                 [--trace] [--out DIR] [--json]
      Open the game in a Playwright Chromium, run the scenario, print the report. Exit 1 on failure.
  gamelab headroom [dir|url] [--command start_race] [--wait 5] [--steps 1,2,4,6,8] [--hold 4] [--target 30]
                 [--profile ID] [--device X] [--width W --height H] [--json]
      CPU headroom sweep: how much slower a device can be before the game drops below --target fps.
      --command sends a window.__game command first (to get into gameplay), --wait seconds before measuring.
  gamelab export <scenario.json> [dir|url] --out DIR [--profile ID] [--device X] [--viewport WxH] [--port N] [--overwrite]
      Write a standalone Playwright project replaying the scenario (for CI).
  gamelab devices [--json]
      List device profiles: 16 seeded (phones, tablets, handhelds, desktops, portal embeds) plus
      your own from ~/.gamelab/devices.json (edit them in the shell's device menu or with save_device).
  gamelab mcp    [--out DIR]
      Run as an MCP server over stdio (for Claude Code, Cursor, Copilot CLI, Codex, Gemini CLI …).
  gamelab tools
      List the tool catalogue (names + descriptions).
  gamelab config <claude|cursor|copilot|codex|gemini|vscode|generic> [--out DIR]
      Print the MCP config snippet for an agent.

Scenario file: {"name": "smoke", "steps": [{"do": "waitFor", "expr": "window.__gp.metrics().webgl.drawCallsTotal > 0"}, …]}
Artifacts (screenshots, reports, traces, video) go to --out, $GAMELAB_OUT, or ./.gamelab.
`;

const OPTIONS = {
    isolation: { type: "string" }, port: { type: "string" }, out: { type: "string" }, watch: { type: "boolean", default: true },
    device: { type: "string" }, landscape: { type: "boolean" }, cpu: { type: "string" }, network: { type: "string" },
    headless: { type: "boolean" }, width: { type: "string" }, height: { type: "string" }, video: { type: "boolean" }, har: { type: "boolean" },
    trace: { type: "boolean" }, json: { type: "boolean" }, viewport: { type: "string" }, overwrite: { type: "boolean" }, profile: { type: "string" },
    open: { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
    command: { type: "string" }, wait: { type: "string" }, steps: { type: "string" }, hold: { type: "string" }, target: { type: "string" },
};

const isUrl = (s) => /^https?:\/\//.test(s ?? "");
const sourceInput = (s) => (s ? (isUrl(s) ? { url: s } : { dir: s }) : {});
const outDir = (v) => path.resolve(v ?? process.env.GAMELAB_OUT ?? path.join(process.cwd(), ".gamelab"));
const stderr = (m) => process.stderr.write(m + "\n");
function openInBrowser(url) {
    const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", (e) => stderr(`could not open browser: ${e.message}`)).unref();
}

async function readScenario(file) {
    if (!file) throw new GameLabError("usage", "Missing <scenario.json>");
    const s = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(s.steps) || !s.steps.length) throw new GameLabError("bad_scenario", `${file}: expected {"steps": [...]}`);
    s.name ??= path.basename(file, ".json");
    return s;
}

function keepAlive(preview) {
    const stop = async () => { await preview.close(); process.exit(0); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return new Promise(() => {});
}

export async function main(argv = process.argv.slice(2)) {
    const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, allowNegative: true });
    const [cmd, ...rest] = positionals;
    if (o.version) return console.log(version);
    if (o.help || !cmd) return console.log(HELP);

    const common = { cwd: process.cwd(), filesDir: outDir(o.out), log: stderr, defaultTarget: "auto" };

    switch (cmd) {
        case "serve": {
            const p = await openPreview({ ...sourceInput(rest[0]), isolation: o.isolation, watch: o.watch, device: o.profile }, { ...common, port: o.port ? Number(o.port) : 0 });
            console.log(`Shell:  ${p.shellUrl}\nGame:   ${p.gameUrl}\nSource: ${p.source}${p.ui.isolation ? "  (COOP/COEP on)" : ""}${p.ui.emulation ? `\nDevice: ${p.ui.emulation.name} (${p.ui.viewport})` : ""}\nCtrl-C to stop.`);
            if (o.open) openInBrowser(p.shellUrl);
            return keepAlive(p);
        }

        case "run": {
            const scenario = await readScenario(rest[0]);
            const p = await openPreview({ ...sourceInput(rest[1]), watch: false }, common);
            let code = 1;
            try {
                await callTool(p, "lab_open", {
                    profile: o.profile, device: o.device, landscape: o.landscape, headless: o.headless, video: o.video, har: o.har,
                    cpu: o.cpu ? Number(o.cpu) : undefined, network: o.network,
                    width: o.width ? Number(o.width) : undefined, height: o.height ? Number(o.height) : undefined,
                });
                if (o.trace) await callTool(p, "trace_start", { kind: "chrome", name: scenario.name });
                const report = await callTool(p, "run_scenario", { ...scenario, target: "lab" });
                const trace = o.trace ? await callTool(p, "trace_stop", { kind: "chrome" }) : undefined;
                const artifacts = await callTool(p, "lab_close");
                if (o.json) console.log(JSON.stringify({ report, trace, artifacts }, null, 2));
                else printReport(report, trace, artifacts);
                code = report.passed ? 0 : 1;
            } finally {
                await p.close();
            }
            process.exitCode = code;
            return;
        }

        case "headroom": {
            const p = await openPreview({ ...sourceInput(rest[0]), watch: false }, common);
            try {
                await callTool(p, "lab_open", { profile: o.profile, device: o.device, headless: true, width: o.width ? Number(o.width) : undefined, height: o.height ? Number(o.height) : undefined });
                await callTool(p, "run_scenario", { name: "headroom-warmup", target: "lab", steps: [{ do: "waitFor", expr: "window.__gp && window.__gp.metrics().webgl.drawCallsTotal > 0", timeoutMs: 60000 }] });
                if (o.command) await callTool(p, "game_command", { name: o.command, target: "lab" });
                await new Promise((r) => setTimeout(r, (o.wait ? Number(o.wait) : 5) * 1000));
                const res = await callTool(p, "headroom", { steps: o.steps ? o.steps.split(",").map(Number) : undefined, holdMs: o.hold ? Number(o.hold) * 1000 : undefined, targetFps: o.target ? Number(o.target) : undefined });
                await callTool(p, "lab_close");
                if (o.json) console.log(JSON.stringify(res, null, 2));
                else {
                    console.log(`\nCPU headroom (target ${res.targetFps} fps, ${res.holdMs / 1000} s per step)\n`);
                    console.log("  slowdown   fps   p50 ms   p95 ms   1% low   main ms   hitches  bound");
                    for (const r of res.steps) console.log(`  ${String(r.cpu + "×").padEnd(9)} ${String(r.fps ?? "?").padStart(4)}   ${String(r.p50Ms ?? "?").padStart(6)}   ${String(r.p95Ms ?? "?").padStart(6)}   ${String(r.low1PctFps ?? "–").padStart(6)}   ${String(r.mainThreadMs ?? "–").padStart(7)}   ${String(r.hitches).padStart(7)}  ${r.bound ?? ""}`);
                    console.log(`\n${res.verdict}${res.hint ? "\n" + res.hint : ""}\n${res.scale}`);
                }
                process.exitCode = res.maxOkSlowdown === null ? 1 : 0;
            } finally { await p.close(); }
            return;
        }

        case "export": {
            const scenario = await readScenario(rest[0]);
            if (!o.out) throw new GameLabError("usage", "export needs --out DIR");
            const p = await openPreview({ ...sourceInput(rest[1]), watch: false }, common);
            try {
                const r = await callTool(p, "export_test", { ...scenario, outDir: o.out, profile: o.profile, device: o.device, viewport: o.viewport, port: o.port ? Number(o.port) : undefined, overwrite: o.overwrite });
                console.log(JSON.stringify(r, null, 2));
            } finally { await p.close(); }
            return;
        }

        case "mcp": {
            const { startMcpServer } = await import("./mcp.mjs");
            return startMcpServer({ filesDir: outDir(o.out), cwd: process.cwd(), log: stderr });
        }

        case "devices": {
            const { allDevices, describeDevice, GROUP_LABELS, USER_DEVICES_PATH } = await import("./devices.mjs");
            const list = await allDevices();
            if (o.json) return console.log(JSON.stringify({ userFile: USER_DEVICES_PATH(), devices: list }, null, 2));
            let group = null;
            for (const d of list) {
                if (d.group !== group) { group = d.group; console.log(`\n${GROUP_LABELS[group] ?? group}`); }
                console.log(`  ${d.id.padEnd(20)} ${d.name.padEnd(22)} ${describeDevice(d)}${d.user ? d.overrides ? "  (edited)" : "  (yours)" : ""}`);
            }
            console.log(`\nUser profiles: ${USER_DEVICES_PATH()}\nUse: gamelab serve . --profile <id> · gamelab run s.json . --profile <id> · gamelab export … --profile <id>`);
            return;
        }

        case "tools":
            for (const t of [{ name: "open", description: "(mcp) Open a preview from dir/url." }, { name: "close", description: "(mcp) Close a preview." }, { name: "list", description: "(mcp) List previews." }, ...TOOLS]) {
                console.log(`${t.name.padEnd(20)} ${t.description.split(/(?<=\.)\s/)[0]}`);
            }
            return;

        case "config":
            return console.log(configSnippet(rest[0] ?? "generic", o.out));

        default:
            throw new GameLabError("usage", `Unknown command "${cmd}". Run gamelab --help.`);
    }
}

function printReport(report, trace, artifacts) {
    const mark = (ok) => (ok ? "✓" : "✗");
    const brief = (r) => (r && typeof r === "object" ? Object.entries(r).filter(([k]) => k !== "hint").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ").slice(0, 90) : "");
    console.log(`${mark(report.passed)} ${report.name}: ${report.summary?.passed ?? "?"}/${report.summary?.steps ?? "?"} steps passed in ${Math.round(report.durationMs ?? 0)} ms  (${report.target})`);
    for (const s of report.steps ?? []) {
        console.log(`  ${s.skipped ? "·" : mark(s.ok)} ${String(s.index ?? "").padStart(2)} ${s.do.padEnd(16)} ${s.skipped ? "skipped" : brief(s.result)}${s.error ? `  — ${s.error}` : ""}`);
    }
    if (report.reportPath) console.log(`  report: ${report.reportPath}`);
    if (trace?.summary) {
        const t = trace.summary;
        console.log(`  trace:  ${trace.path}\n          ${Math.round(t.wallMs)} ms, ~${t.approxFps ?? "?"} fps, ${t.longTasks?.count ?? 0} long tasks (worst ${Math.round(t.longTasks?.worst?.[0]?.durMs ?? 0)} ms), GC ${Math.round(t.gcMs ?? 0)} ms`);
    }
    for (const a of artifacts?.artifacts ?? []) if (a.kind !== "chrome-trace") console.log(`  ${a.kind}: ${a.path}`);
}

export function configSnippet(agent, out) {
    const args = ["-y", "gamelab", "mcp", ...(out ? ["--out", out] : [])];
    const server = { command: "npx", args };
    const json = (root) => JSON.stringify(root, null, 2);
    switch (agent) {
        case "claude":
            return `# Claude Code — run:\nclaude mcp add gamelab -- npx ${args.join(" ")}\n\n# or in .mcp.json:\n${json({ mcpServers: { gamelab: server } })}`;
        case "cursor":
            return `# Cursor — .cursor/mcp.json (project) or ~/.cursor/mcp.json (global):\n${json({ mcpServers: { gamelab: server } })}`;
        case "copilot":
            return `# GitHub Copilot CLI — ~/.copilot/mcp-config.json (or .github/copilot/mcp.json in a repo):\n${json({ mcpServers: { gamelab: { type: "local", command: "npx", args, tools: ["*"] } } })}`;
        case "vscode":
            return `# VS Code — .vscode/mcp.json:\n${json({ servers: { gamelab: { type: "stdio", command: "npx", args } } })}`;
        case "codex":
            return `# OpenAI Codex CLI — ~/.codex/config.toml:\n[mcp_servers.gamelab]\ncommand = "npx"\nargs = ${JSON.stringify(args)}`;
        case "gemini":
            return `# Gemini CLI — ~/.gemini/settings.json:\n${json({ mcpServers: { gamelab: server } })}`;
        default:
            return `# Generic MCP (stdio):\n${json({ mcpServers: { gamelab: server } })}\n\n# From a local checkout instead of npx: {"command": "node", "args": ["${path.resolve(import.meta.dirname, "../bin/gamelab.mjs")}", "mcp"]}`;
    }
}
