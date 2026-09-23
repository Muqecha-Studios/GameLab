# gamelab

Harness-agnostic test lab for HTML5/WebGL games — Godot and Unity web exports, Phaser, PixiJS, Three.js, plain canvas.

It serves your build (or proxies your dev server) with an instrumented hook, drives a real Chromium through Playwright, and exposes everything as **an MCP server** (for any AI agent), **a CLI** (for humans and CI) and **a Node API** (for embedding — the GitHub Copilot `game-preview` canvas is one such embedding).

```
                ┌────────────┐   MCP/stdio   ┌───────────────────────┐
  Claude Code,  │            │◄─────────────►│ gamelab               │
  Cursor,       │   agent    │               │  ├ preview server     │──► your build / dev server
  Copilot CLI,  │            │   CLI         │  │   + hook (fps, gl,  │        (hook injected)
  Codex, Gemini └────────────┘◄──── you ────►│  │     console, load)  │
                                             │  ├ lab (Playwright)   │──► headed/headless Chromium
                                             │  ├ scenarios          │      device/touch/gamepad/
                                             │  └ export → CI tests  │      throttle/trace/video
                                             └───────────────────────┘
```

## What you get

| Area | Capabilities |
|---|---|
| Serving | Static build folder with correct wasm/br/gz MIME, optional COOP/COEP (SharedArrayBuffer), or a proxy to a dev server with HMR WebSocket passthrough; file watcher → auto-reload |
| Hook (in-page) | FPS + frame-time percentiles, hitch log (>50 ms), WebGL draw/instance/texture/shader/buffer counters, context-loss tracking, first frame / first draw, load timeline (slowest & largest assets), console + error capture, **CPU profile** (JS Self-Profiling API: hot functions, subtrees, per-file, busy/idle/GC), `window.__gp` API |
| Shell (browser tab) | The served page at `/__gp/`: the game in an iframe with FPS badge, viewport presets, isolation toggle, a Console drawer and a **Perf** tab — live frame/hitch/WebGL/memory/load stats, plain-English **Findings** (e.g. "not holding 60 fps", "shader compiles after startup", "heap growing 12 MB/min", "wasm served uncompressed"), and a ● Profile button that lists the hottest functions with file:line |
| Lab (Playwright Chromium) | Trusted keyboard/mouse, touch (tap/hold/swipe), virtual gamepad, device presets (iPhone/Pixel/iPad…), CPU throttling, network presets (slow-3g … offline), visibility/lifecycle freeze, WebGL context loss, Chrome performance trace (+ long-task/GC summary), Playwright trace, video, HAR |
| Scenarios | JSON steps → pass/fail report: `waitFor`, `key`, `click`, `tap`, `swipe`, `gamepad`, `eval`, `assert`, `expectFps`, `expectNoErrors`, `expectNoHitches`, `screenshot`, `throttle`, … |
| Export | Standalone Playwright project (`tests/*.spec.ts`, config with a webServer that reproduces the headers) so the same scenario runs in CI with pixel-diff screenshots |

## Install

```sh
npm i -g gamelab          # or run ad hoc with: npx gamelab …
```

Needs Node ≥ 20. `postinstall` downloads Playwright's Chromium (set `GAMELAB_SKIP_BROWSER=1` to skip).

## Use it from an AI agent (MCP)

```sh
gamelab config claude     # prints the snippet / command for Claude Code
gamelab config cursor     # .cursor/mcp.json
gamelab config copilot    # ~/.copilot/mcp-config.json
gamelab config vscode | codex | gemini | generic
```

The generic form:

```json
{ "mcpServers": { "gamelab": { "command": "npx", "args": ["-y", "gamelab", "mcp"] } } }
```

Then tell the agent, e.g. *"open the Godot export in builds/web, run it on an iPhone 14 with 4× CPU throttle, and tell me the frame-time p95 and any hitches"*. The agent will call:

1. `open { dir }` → returns a shell URL a human can open to watch/play, and the direct game URL.
2. `lab_open { device: "iPhone 14", landscape: true, cpu: 4 }` → real Chromium.
3. `run_scenario`, `get_metrics`, `profile`, `trace_start/stop`, `screenshot` (returned inline as an image), …
4. `export_test { outDir: "tests/web" }` to turn the run into a CI test.

MCP tools: `open close list` + `reload get_logs clear_logs get_stats get_metrics get_load_timeline profile screenshot eval press_key click set_visibility lose_webgl_context set_viewport set_options lab_open lab_close lab_status touch gamepad set_throttle trace_start trace_stop run_scenario export_test`. Every tool accepts an optional `instance` (defaults to the last opened) and most accept `target: panel | lab | auto`.

Artifacts (screenshots, `.report.json`, `.trace.json`, `.webm`, `.har`) go to `--out`, `$GAMELAB_OUT` or `./.gamelab`.

## Use it from the terminal / CI

```sh
gamelab serve builds/web --open                # serves + opens the shell (stats, console, Perf tab) in your browser
gamelab serve http://localhost:5173/           # proxy a dev server (Vite/Phaser/etc.)

gamelab run smoke.json builds/web --device "iPhone 14" --landscape --cpu 4 --trace
gamelab run smoke.json builds/web --headless   # CI: software WebGL via SwiftShader; exit 1 on failure

gamelab export smoke.json builds/web --out tests/web
cd tests/web && npm i && npx playwright test --update-snapshots
```

`smoke.json`:

```json
{
  "name": "smoke",
  "steps": [
    { "do": "waitFor", "expr": "window.__gp.metrics().webgl.drawCallsTotal > 0", "timeoutMs": 30000 },
    { "do": "key", "key": "ArrowUp", "holdMs": 1500 },
    { "do": "expectFps", "min": 50 },
    { "do": "expectNoErrors" },
    { "do": "expectNoHitches", "max": 2 },
    { "do": "screenshot", "name": "after-start" }
  ]
}
```

## Use it from Node

```js
import { openPreview, callTool } from "gamelab";

const p = await openPreview({ dir: "builds/web" }, { filesDir: ".gamelab" });
await callTool(p, "lab_open", { device: "Pixel 7", cpu: 4 });
const report = await callTool(p, "run_scenario", { steps: [/* … */] });
const metrics = await callTool(p, "get_metrics");
await p.close();
```

`TOOLS` (from `gamelab/tools`) is the catalogue — `{ name, description, inputSchema, handler(preview, input) }` — so any host can map it onto its own surface in a few lines. The Copilot canvas adapter is ~80 lines.

## Panel vs lab

- **panel** – whatever browser has the shell UI (`http://127.0.0.1:PORT/__gp/`) open: a human watching, or an embedded webview. Input is synthetic, metrics come from the hook.
- **lab** – Playwright Chromium: trusted input, emulation, throttling, traces. Headed by default (real GPU); `headless: true` for determinism/CI.
- `target: "auto"` (default outside embedded canvases) uses the lab when open, otherwise the panel.

## Caveats

- Video/Playwright-trace recording uses a screencast that costs frames; don't combine with fps/hitch assertions.
- Headless Chromium renders WebGL with SwiftShader — good for correctness, not for performance numbers.
- Emulates devices, not GPUs: real iOS Safari / Android GPU behaviour still needs a device.
- Engine-internal profilers (Unity Profiler, Godot's debugger) aren't replaced — this is the browser-side view.

## License

MIT
