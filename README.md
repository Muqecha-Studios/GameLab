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
| Shell (browser tab) | The served page at `/__gp/`: the game in an iframe with FPS badge, a **device profile** menu (resolution + DPR/UA/touch/cores emulation, editable), isolation toggle, a Console drawer and a **Perf** tab — live frame/hitch/WebGL/memory/load stats, plain-English **Findings** (e.g. "not holding 60 fps", "shader compiles after startup", "heap growing 12 MB/min", "wasm served uncompressed"), a ● Profile button that lists the hottest functions with file:line, and a **Timeline** tab — FPS, worst frame ms, draw calls, heap and engine timings graphed over time (30 s → 20 min) with game events, console errors and reloads as markers; hover for values, toggle series, export CSV |
| Lab (Playwright Chromium) | Trusted keyboard/mouse, touch (tap/hold/swipe), virtual gamepad, device presets (iPhone/Pixel/iPad…), CPU throttling, network presets (slow-3g … offline), visibility/lifecycle freeze, WebGL context loss, Chrome performance trace (+ long-task/GC summary), Playwright trace, video, HAR |
| Game probe (opt-in) | A 20-line contract (`window.__game`) plus drop-in probes for **Godot** (autoload), **Unity** (`.cs` + `.jslib`) and plain **web** games: game state (scene, phase, score…), engine timings (process/physics/render ms, draw calls, nodes, GC alloc, texture memory), named events and remote commands. Shows up in the Perf tab, in findings ("physics is 45 % of the frame", "3 orphan nodes"), and as scenario steps |
| Scenarios | JSON steps → pass/fail report: `waitFor`, `key`, `click`, `tap`, `swipe`, `gamepad`, `eval`, `assert`, `expectFps`, `expectNoErrors`, `expectNoHitches`, `screenshot`, `throttle`, `waitForState`, `assertState`, `gameCommand`, `waitForEvent`, … |
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

MCP tools: `open close list` + `reload get_logs clear_logs get_stats get_history get_metrics get_load_timeline profile get_game_state game_command screenshot eval press_key click set_visibility lose_webgl_context set_viewport set_options list_devices save_device delete_device lab_open lab_close lab_status touch gamepad set_throttle trace_start trace_stop run_scenario export_test`. Every tool accepts an optional `instance` (defaults to the last opened) and most accept `target: panel | lab | auto`.

Artifacts (screenshots, `.report.json`, `.trace.json`, `.webm`, `.har`) go to `--out`, `$GAMELAB_OUT` or `./.gamelab`.

## Use it from the terminal / CI

```sh
gamelab serve builds/web --open                # serves + opens the shell (stats, console, Perf tab) in your browser
gamelab serve http://localhost:5173/           # proxy a dev server (Vite/Phaser/etc.)

gamelab run smoke.json builds/web --profile budget-android --trace     # 360×800 @2x, touch, Android UA, cpu ×6, fast-3g
gamelab run smoke.json builds/web --device "iPhone 14" --landscape --cpu 4
gamelab run smoke.json builds/web --headless   # CI: software WebGL via SwiftShader; exit 1 on failure

gamelab export smoke.json builds/web --out tests/web --profile iphone-se
gamelab devices                                 # list seeded + your own profiles
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

## Instrument your game (optional, recommended)

Out of the box gamelab sees what the browser sees: frames, WebGL calls, memory, console, JS hot functions. It cannot see *inside* the engine — which scene is running, whether the race started, how long physics took. For that the game exposes a tiny object:

```js
window.__game = {
  engine: "godot", version: "4.7.2",
  state:   () => ({ scene: "Race", phase: "playing", lap: 2, speed: 143 }),  // anything JSON-able
  metrics: () => ({ processMs: 3.1, physicsMs: 1.2, drawCalls: 212, nodes: 843 }),
  command: (name, args) => { /* "start_race", "set_seed", "teleport"… */ },
};
performance.mark("level-loaded");                                         // marks show in traces / load timeline
window.dispatchEvent(new CustomEvent("gamelab", { detail: { type: "event", name: "lap", data: { n: 2 } } }));
```

Ready-made probes live in [`probes/`](probes/):

| Engine | Drop in | Notes |
|---|---|---|
| Godot 4 | `probes/godot/gamelab_probe.gd` → Project Settings → Autoload (name `GameLabProbe`) | Pushes `Performance` monitors (process/physics/navigation ms, nodes, orphan nodes, draw calls, primitives, video/texture memory, physics pairs, custom monitors) every 250 ms via `JavaScriptBridge`. Call `GameLabProbe.set_state({...})`, `.mark("x")`, `.event("lap", {...})`; connect `command_received(name, args)`. Auto-tracks current scene, paused, time_scale. No-op outside the web export. |
| Unity (WebGL) | `probes/unity/GameLabProbe.cs` + `GameLabProbe.jslib` anywhere under `Assets/` | Self-instantiates; uses `ProfilerRecorder` (main-thread ms, GC alloc/frame, memory, draw/SetPass/batches/triangles — render counters need a Development Build). `GameLabProbe.SetState(...)`, `.Mark`, `.Event`, `StateProvider`, `MetricsProvider`, `CommandReceived`. Compiled out except `UNITY_WEBGL`. |
| Phaser / Three / Pixi / custom | `probes/web/gamelab-probe.js` (UMD) | `const g = installProbe({ engine: "three", state: () => ..., metrics: () => renderer.info.render, onCommand })`; `g.setState({...})`, `g.mark("x")`, `g.event("died")`. |

Well-known metric keys (colour-coded against the 16.7 ms budget and used by findings): `processMs physicsMs renderMs scriptMs frameMs gcAllocKB entities nodes orphanNodes drawCalls setPassCalls textureMB`. Anything else is shown as-is; put engine-specific counters under `custom`.

What you get once a probe is present:

- Perf tab gains **Game / State / Engine / Events** sections; events also appear in the Console (◆ `lap {"n":2}`).
- Findings: physics or script time eating the frame budget, per-frame GC allocation, orphan nodes (Godot leak), node/entity count growing without bound, high SetPass counts.
- Tools: `get_game_state` (state + metrics + recent events), `game_command { name, args }`.
- Scenario steps with `state`, `metrics`, `events` in scope:

```json
{ "do": "gameCommand", "name": "start_race", "args": { "seed": 7 } },
{ "do": "waitForState", "expr": "state.phase === 'playing'", "timeoutMs": 10000 },
{ "do": "waitForEvent", "event": "lap", "timeoutMs": 60000 },
{ "do": "assertState", "expr": "metrics.physicsMs < 4 && state.lap >= 1" }
```

Debug/development exports keep function names in the wasm, so `profile` shows `Node::_propagate_process` instead of `wasm-function[1234]`.

## Device profiles

The shell's device menu (and `list_devices` / `gamelab devices`) ships 16 seeded profiles — iPhone SE/15/15 Pro Max, Pixel 7, Galaxy S23, a budget Android, iPad/iPad Pro/Galaxy Tab, Steam Deck, Chromebook, laptop, 1080p/4K desktop, itch.io and portal embeds — each with resolution, pixel ratio, touch, mobile UA, CPU slowdown, network preset, cores and memory.

Selecting one in the **panel** resizes the frame and reloads the game with the hook overriding `devicePixelRatio`, `navigator.userAgent`/`platform`/`userAgentData`, `maxTouchPoints`, `hardwareConcurrency`, `deviceMemory` and `screen.*` before any game script runs — so the engine picks the DPR, input mode and quality tier it would on that device. The badge reads "as iPhone 15" when overrides are active. A browser cannot slow its own CPU or network, so those two are shown as **lab** chips; **Run in lab** (or `lab_open { profile }`, `gamelab run --profile`) opens a Playwright Chromium with the full profile including throttling. `export_test { profile }` bakes it into the generated `playwright.config.ts` plus a leading `throttle` step.

Profiles are editable: **New** / duplicate / edit / delete in the menu, or `save_device` / `delete_device`. Your profiles live in `~/.gamelab/devices.json` (`$GAMELAB_HOME` to move it) — a plain `{ "devices": [ … ] }` list you can commit next to your project. Saving under a seeded id overrides that seed; deleting the override restores it.

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
