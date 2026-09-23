// The gamelab guide: how to use the tool and what every number means.
// One source of truth rendered by the CLI (`gamelab guide [topic]`), the MCP
// `guide` tool, and the shell's Guide panel (? key).
//
// Each section: { id, title, perf?, summary, steps?, items: [[term, text]] }.
// `perf` is the Perf-tab section header it documents, so clicking that header
// in the shell opens the right page.

export const EXAMPLES = [
    { name: "WebGL Aquarium", url: "https://webglsamples.org/aquarium/aquarium.html", tags: "GPU stress · WebGL", note: "Chrome team's GPU benchmark. Set the fish count on the page (1–30,000) to push the GPU and watch the CPU/GPU verdict." },
    { name: "Bruno Simon — drivable world", url: "https://bruno-simon.com/", tags: "three.js · physics", note: "A driveable 3D portfolio. Many shader compiles and ~58 MB of textures — good for hitch causes." },
    { name: "PlayCanvas — After the Flood", url: "https://playcanv.as/e/p/44MRmJRU/", tags: "PlayCanvas · heavy load", note: "~14 MB download and lots of shader compiles on start — good for the Load section." },
    { name: "HexGL", url: "https://hexgl.bkcore.com/play/", tags: "racing game · three.js", note: "Futuristic racer. Click through the menu to start a race." },
    { name: "three.js — instancing performance", url: "https://threejs.org/examples/webgl_instancing_performance.html", tags: "three.js · draw calls", note: "Switch between instanced, merged and naive modes and watch draws/frame change." },
    { name: "three.js — animation keyframes", url: "https://threejs.org/examples/webgl_animation_keyframes.html", tags: "three.js · light", note: "A small animated scene; an easy first test." },
    { name: "Phaser — Breakout", url: "https://labs.phaser.io/view.html?src=src/games/breakout/breakout.js", tags: "Phaser · 2D", note: "A playable 2D game. The site may show a bot check first in some browsers." },
];

export const GUIDE = [
    {
        id: "start", title: "Getting started",
        summary: "gamelab runs your web game with a small script injected, so it can measure frames, the GPU, memory and input while you (or an agent) play.",
        steps: [
            "Open a game: run `gamelab` and pick a build folder or paste a URL, or run `gamelab serve <folder|url> --open`. A build folder is the export folder that holds index.html (Godot/Unity web export, `dist/`, …).",
            "Play it in the shell. The header shows live FPS; the drawer below has Console, Perf and Timeline.",
            "Read the Perf tab's Findings first — it says what is limiting the game and what to try. Click any Perf section title to open its page in this guide.",
            "Use the Timeline to see when things went wrong: pause it (Space), drag back to the spike, hover to read every value at that moment.",
            "Press ● Profile while the slow part is happening to list the hottest functions.",
            "For phones and slow devices, pick a device profile (the Fill panel menu) or run it in the lab: `gamelab run`, `gamelab headroom`.",
        ],
        items: [
            ["No game handy?", "Try one of the examples in the Open dialog, or: `gamelab serve https://webglsamples.org/aquarium/aquarium.html --open`."],
            ["Deployed games", "Any command accepts an https:// URL. gamelab proxies the site so the script can be injected. Use the game's own page — itch.io and other portals wrap games in an iframe from another domain; open that iframe's URL."],
            ["Agents", "Everything in the shell is also an MCP tool (`gamelab mcp`): get_metrics, get_history, get_logs, profile, headroom, … See the \"agents\" topic."],
        ],
    },
    {
        id: "shell", title: "The shell (header and drawer)",
        summary: "The browser page gamelab opens. The game runs in the middle; everything around it is instrumentation.",
        items: [
            ["● connection dot", "Green when the injected script is talking to the shell. Red while the game loads, or if the page blocked the script."],
            ["Folder button", "Open a different game: a build folder or a URL (O)."],
            ["isolated / not isolated", "Whether the page is cross-origin isolated (COOP/COEP headers). Needed for SharedArrayBuffer, which Godot and Unity use for threads. The isolated toggle turns the headers on or off; gamelab turns them on automatically for folders that look like Godot/Unity exports."],
            ["WebGL2 / WebGL / WebGPU", "Graphics APIs this browser offers. Hover for the GPU renderer string and max texture size."],
            ["dpr N / as <device>", "devicePixelRatio of the game frame, or the device profile being emulated."],
            ["Fill panel ▾", "Device profile menu: phones, tablets, handhelds, desktops, portal embeds, or your own. Sets resolution, pixel ratio, touch, user agent and (in the lab) CPU/network throttling. Changing it reloads the game."],
            ["⟳ rotate", "Swap portrait and landscape."],
            ["auto", "Reload the game when files in the served folder change (folders only; off for remote URLs)."],
            ["Sparkline + fps", "Frames per second over the last ~32 s. Amber under 55, red under 30."],
            ["MB · dc", "JS heap in MB (Chromium only) and draw calls in the last frame."],
            ["Drawer button / D", "Show or hide the drawer. Drag its top edge to resize."],
            ["Reload / R", "Reload the game (not the shell)."],
            ["Console tab", "console.* output, uncaught errors, promise rejections and game events. Filter by level or text."],
            ["Perf tab", "Everything measured right now, grouped into sections, plus Findings. Reset clears hitches and frame samples."],
            ["Timeline tab", "The same numbers over time. See the \"timeline\" topic."],
            ["Shortcuts", "R reload · D drawer · O open a game · ? guide. They work when the shell (not the game) has focus — click the header first."],
        ],
    },
    {
        id: "timeline", title: "Timeline",
        summary: "Every metric is sampled every 0.5 s for the last ~20 minutes, drawn as stacked lanes that share one time axis.",
        items: [
            ["Series chips", "Show or hide a lane. Lanes without data are hidden automatically; ‹ › scroll the chip row when it overflows."],
            ["FPS", "Frames rendered in each 0.5 s window. Dashed lines at 60 and 30."],
            ["Frame worst", "The single longest frame in each window, in ms. Spikes here are stutters even when average FPS looks fine."],
            ["Draw calls", "Average draw calls per frame in the window."],
            ["JS heap", "JavaScript heap in MB. A saw-tooth is garbage collection; a line that only climbs is a leak."],
            ["Engine process / physics / render / script, Nodes", "Numbers reported by the engine probe, if the game ships one (see \"game\")."],
            ["Main thread", "CPU time per frame on the main thread (see \"cpu-gpu\")."],
            ["GPU", "GPU time per frame (desktop Chrome only)."],
            ["Input lag", "Input-to-frame latency, drawn as dots only when you pressed something."],
            ["Programs / Tex binds / GL state per frame, Tex memory, wasm memory, DOM nodes", "Off by default; turn them on from the chips. See \"webgl\" and \"memory\"."],
            ["Marks", "Dotted vertical lines for game events (green), errors (red) and reloads (blue)."],
            ["Pause / Live (Space)", "Freeze the view to inspect it. Samples keep recording; press Live or End to follow again."],
            ["Move and zoom", "Drag the chart, shift-scroll or swipe sideways to move; ← → keys; Home jumps to the start. ⌘/Ctrl-scroll or + − to zoom."],
            ["Overview strip", "The whole session's FPS under the lanes. Drag the highlighted window to jump; double-click to go live."],
            ["CSV", "Download every sample."],
        ],
    },
    {
        id: "frame", title: "Frame timing", perf: "Frame",
        summary: "How long frames take. At 60 Hz each frame has a 16.7 ms budget (8.3 ms at 120 Hz). Percentiles describe the distribution of recent frames.",
        items: [
            ["p50", "Median frame time. 16.7 ms on a 60 Hz display means the game keeps up."],
            ["p95 / p99", "The frame time that 95% / 99% of frames beat. Rising p95 with a steady p50 means occasional slow frames."],
            ["max", "The longest recent frame."],
            ["1% low", "Average FPS of the slowest 1% of frames — what stutter feels like. Under 30 is clearly visible."],
            ["0.1% low", "Same for the slowest 0.1% (needs ≥1000 samples)."],
            ["jitter", "Standard deviation of frame time. Uneven pacing feels worse than a steady lower FPS; over ~8 ms is noticeable."],
            ["dropped", "Share of frames longer than 1.5× the median."],
            ["hitches", "Frames over 50 ms, each listed with its likely cause (see \"hitches\")."],
            ["samples", "Frames in the rolling window used for these numbers."],
            ["visibility", "visible or hidden. Browsers throttle hidden tabs to ~1 FPS, so numbers from hidden periods don't count."],
            ["uptime", "Time since the game page loaded."],
        ],
    },
    {
        id: "cpu-gpu", title: "CPU / GPU and the bottleneck verdict", perf: "CPU / GPU",
        summary: "Splits each frame into main-thread (CPU) time and GPU time, then says which one limits the frame rate.",
        items: [
            ["main thread p50 / p95 / max", "Time from the start of the frame callback until the browser finished its rendering steps: your game logic, engine update, WebGL command submission, style/layout. Measured with a MessageChannel probe."],
            ["GPU p50 / p95", "Time the GPU spent on the game's draw calls, from WebGL timer queries (EXT_disjoint_timer_query). Desktop Chrome with a real GPU only; headless or software rendering reports n/a."],
            ["disjoint", "GPU timer samples discarded because the clock was reset (power state change)."],
            ["vsync-limited", "Holding the display rate with headroom to spare. Headroom = 16.7 ms minus the busier of CPU and GPU."],
            ["vsync-limited, little headroom", "Holding the rate with under 4 ms to spare — a slower device will drop frames."],
            ["CPU-bound", "Main thread uses ≥75% of the frame. Profile it; reduce per-frame JS, physics or draw-call submission."],
            ["GPU-bound", "GPU uses ≥75% of the frame. Lower resolution or pixel ratio, simplify shaders, cut overdraw or post-processing."],
            ["likely GPU-bound", "The main thread is mostly idle but frames are still slow, and GPU timing isn't available here. Usually the GPU (or a 30 Hz display / throttled tab)."],
            ["mixed", "Neither side clearly dominates."],
            ["collecting…", "Fewer than 120 frame samples so far."],
        ],
    },
    {
        id: "hitches", title: "Hitches and long tasks", perf: "Hitches",
        summary: "A hitch is a frame over 50 ms. gamelab records what happened during it to guess the cause.",
        items: [
            ["shader compile", "A shader was compiled mid-game. Pre-warm materials behind a loading screen or at scene start."],
            ["texture upload (W×H KB)", "A texture was sent to the GPU. Preload, use smaller or compressed textures (KTX2/Basis), or upload over several frames."],
            ["buffer upload", "Large vertex/index data was sent to the GPU. Reuse buffers; avoid rebuilding meshes every frame."],
            ["wasm memory grow +N MB", "The WebAssembly heap grew, which copies it. Raise the initial memory size in the export settings."],
            ["GC", "The JS heap dropped by ≥3 MB — garbage collection. Allocate less per frame (reuse objects and arrays)."],
            ["readPixels (GPU sync)", "The CPU waited for the GPU to read pixels back. Avoid readPixels/getImageData in the frame loop."],
            ["asset loaded: …", "A network resource finished during the frame (decode/parse cost)."],
            ["during event NAME", "Happened while the game reported that event (from the probe). Look at what the game does then."],
            ["script (no upload/compile/GC seen)", "Nothing attributable — plain game code. Use ● Profile while reproducing it."],
            ["Long tasks", "Main-thread tasks over 50 ms reported by the browser (Long Tasks API), with the same cause attribution. They also delay input."],
        ],
    },
    {
        id: "render", title: "Render resolution", perf: "Render",
        summary: "How many pixels the GPU fills each frame compared with what the screen shows.",
        items: [
            ["canvas", "Size of the drawing buffer the GPU renders into."],
            ["display", "CSS size of the canvas × devicePixelRatio = device pixels on screen."],
            ["scale", "canvas pixels per device pixel. Above 1× wastes fill rate; well under 1× looks soft."],
            ["megapixels", "Pixels filled per frame. Fill-rate cost scales with this; mobile GPUs struggle past ~2–3 MP."],
            ["contexts", "Number of WebGL contexts on the page."],
        ],
    },
    {
        id: "webgl", title: "WebGL counters", perf: "WebGL",
        summary: "Counts of WebGL calls. Each call costs CPU time to submit; state changes also cost GPU time.",
        items: [
            ["draws/frame, draws/s", "Draw calls in the last frame and per second. Hundreds are fine on desktop; mobile likes it under ~200. Batch, instance or merge meshes to reduce."],
            ["instances", "Total instances drawn (instanced draws count each instance)."],
            ["programs/frame", "Shader program switches (useProgram) per frame. Sort draws by material to reduce."],
            ["tex binds/frame", "bindTexture calls per frame. Texture atlases and arrays reduce them."],
            ["fbo binds/frame", "Render-target switches per frame — each post-processing pass or shadow map."],
            ["state/frame", "Blend/depth/cull/viewport/scissor changes per frame."],
            ["tex uploads, buffer uploads", "How many times and how many MB were sent to the GPU. Should be near zero during gameplay."],
            ["shader compiles, programs", "Shaders compiled and programs linked so far. Turns amber when compiles happen after the first ones (mid-game)."],
            ["readbacks", "readPixels calls; each stalls until the GPU catches up."],
            ["ctx lost", "WebGL context losses (GPU reset or out of memory). The game must restore its resources."],
            ["live textures / buffers / renderbuffers / programs / framebuffers", "GPU objects currently alive, with estimated memory. Texture MB is estimated from upload sizes (+34% for mipmaps). A number that keeps growing is a GPU memory leak."],
        ],
    },
    {
        id: "memory", title: "Memory", perf: "Memory",
        summary: "JavaScript and WebAssembly memory. Running out crashes the tab, especially on phones.",
        items: [
            ["heap", "Used JS heap / heap limit in MB (Chromium only)."],
            ["trend", "Heap growth per minute. A steady climb that never drops is a leak."],
            ["GC", "Rough count of garbage collections (heap drops of ≥3 MB)."],
            ["wasm", "WebAssembly linear memory in MB and how many times it grew. Each grow copies the heap and can hitch — set a larger initial size in the Godot/Unity export."],
            ["wasm compile", "Time spent compiling the .wasm file at startup."],
            ["DOM nodes", "Elements on the page. Large HTML UI overlays slow style and layout every frame; over ~3000 is worth a look."],
        ],
    },
    {
        id: "input", title: "Input latency", perf: "Input",
        summary: "How quickly a key press or click shows up on screen.",
        items: [
            ["event → frame p50 / p95 / last", "From the pointer/key event to the next rendered frame. Under ~50 ms feels instant; over 100 ms feels laggy. Long frames and long tasks add directly to it."],
            ["event timing p95", "The browser's own measurement of input to next paint (Event Timing API)."],
            ["samples", "Inputs measured. Press or click something to get data."],
        ],
    },
    {
        id: "audio", title: "Audio", perf: "Audio",
        summary: "Web Audio contexts created by the game.",
        items: [
            ["state", "running or suspended. Browsers keep audio suspended until a user gesture — call resume() on the first click or tap."],
            ["sample rate", "Output sample rate."],
            ["base / output latency", "Delay from the AudioContext to the speaker. Over ~100 ms makes sound feel late."],
            ["worklet", "Whether an AudioWorklet (off-main-thread audio processing) is in use."],
        ],
    },
    {
        id: "threads", title: "Threads", perf: "Threads",
        summary: "Whether the game can use more than one CPU core.",
        items: [
            ["workers", "Web Workers running (and created in total)."],
            ["SharedArrayBuffer", "Required for WebAssembly threads (Godot/Unity threaded builds, Emscripten pthreads). Only available when the page is cross-origin isolated."],
            ["isolated", "crossOriginIsolated. Turn on the isolated toggle, or send COOP/COEP headers from your host."],
            ["cores", "navigator.hardwareConcurrency (or the emulated value from a device profile)."],
        ],
    },
    {
        id: "load", title: "Loading", perf: "Load",
        summary: "What happens between opening the page and the first rendered frame.",
        items: [
            ["first frame", "First requestAnimationFrame callback after navigation."],
            ["first draw", "First WebGL draw call — roughly when the player sees something. Over ~4 s, show a loading screen early and shrink or split the download."],
            ["load event", "The page's load event."],
            ["requests, transfer, decoded", "Number of network requests, bytes over the wire, and bytes after decompression."],
            ["slowest, largest", "The five slowest and largest resources (.wasm, .pck, .data, textures, …). Brotli/gzip compression and texture compression help most."],
            ["marks", "performance.mark() entries the game made (for example scene_loaded)."],
        ],
    },
    {
        id: "game", title: "Game probe (engine numbers)", perf: "Game",
        summary: "Optional: games that ship a gamelab probe expose window.__game with engine internals, state and commands. Probes for Godot (probes/godot/gamelab_probe.gd), Unity (probes/unity/GameLabProbe.cs) and plain JS (probes/web/gamelab-probe.js) are in the gamelab package.",
        items: [
            ["engine, commands", "Engine name and version; whether command(name, args) is wired so an agent can drive the game (start_race, set_time_scale, …)."],
            ["State", "Whatever the game reports: scene, phase, player position, lap, …"],
            ["processMs / physicsMs / renderMs / scriptMs / navigationMs", "Engine time per frame for game logic, physics, rendering, scripts and navigation. Amber at 40% of the frame budget, red at 70%."],
            ["nodes / entities, objects", "Scene nodes (Godot) or GameObjects (Unity), and total engine objects. A count that keeps rising is a leak."],
            ["frameMs, targetFrameRate, timeScale", "Unity frame time as the engine sees it, the frame-rate cap, and Time.timeScale."],
            ["orphanNodes", "Godot nodes removed from the tree but never freed — a leak."],
            ["drawCalls, primitives, renderObjects / setPassCalls, batches, triangles", "The engine's own render statistics (Godot monitors / Unity ProfilerRecorder)."],
            ["videoMemMB, textureMB, bufferMemMB, staticMemMB", "Godot GPU memory (total, textures, buffers) and static CPU memory."],
            ["gcAllocKB, gcReservedMB, monoHeapMB, allocatedMB, reservedMB, totalUsedMB", "Unity managed allocations per frame and memory totals. Allocations every frame cause GC hitches."],
            ["audioLatencyMs", "Godot audio output latency."],
            ["Events", "Events the game emitted (lap_completed, collision, …). They also appear as Timeline marks and in the Console."],
        ],
    },
    {
        id: "findings", title: "Findings", perf: "Findings",
        summary: "gamelab's reading of everything above: the bottleneck, stutter, hitch causes grouped with a fix for each, and warnings for render scale, program switches, GL state, readbacks, texture memory, wasm grows, DOM size, input latency and audio.",
        items: [
            ["Colours", "Red needs fixing, amber is worth a look, neutral is informational."],
            ["Confidence", "Findings need data: play for 10–20 s, and reproduce the slow part, before trusting them. Headless/software-rendered numbers are not representative of real devices."],
        ],
    },
    {
        id: "profile", title: "CPU profile", perf: "Profile",
        summary: "● Profile samples the game's main thread for 3–20 s (JS Self-Profiling API, Chromium) and lists where the time went.",
        items: [
            ["busy / idle", "Share of the window the main thread was running code vs waiting for the next frame."],
            ["GC", "Time spent in garbage collection during the window."],
            ["self", "Time spent in the function itself. Start with the highest self %."],
            ["total", "Time in the function plus everything it called."],
            ["by file", "Self time per script file — shows whether time goes to your code, the engine, or a library."],
            ["source", "file:line of the function. Engine builds are often minified; wasm frames show as native."],
        ],
    },
    {
        id: "lab", title: "Lab, devices and headroom",
        summary: "The lab is a Chromium instance gamelab controls (Playwright). Unlike the shell it can apply real device emulation, CPU and network throttling, trusted input, traces and videos.",
        items: [
            ["Run in lab", "From the device menu: opens the game in the lab with that profile. From the CLI: `gamelab run <scenario.json> <folder|url> --profile budget-android`."],
            ["Device profiles", "16 built-in profiles plus your own (New in the device menu, or ~/.gamelab/devices.json). CPU slowdown and network presets only take effect in the lab."],
            ["CPU slowdown", "Chrome's CPU throttling. Roughly: 4× ≈ mid-range phone, 6× ≈ low-end phone. It does not slow the GPU."],
            ["headroom", "`gamelab headroom <folder|url> --command start_race` steps CPU slowdown 1×, 2×, 4×, 6×, 8× and reports fps, p50/p95, 1% low, main-thread ms and hitches at each step, then the slowdown at which the game drops below --target fps (30 by default)."],
            ["Scenarios", "JSON steps (wait, waitFor, key, click, tap, gameCommand, waitForEvent, expectFps, expectNoHitches, expectNoErrors, screenshot, throttle…) run by `gamelab run`; `gamelab export` turns one into a standalone Playwright test for CI."],
            ["Traces", "--trace records a Chrome performance trace you can open in Perfetto or DevTools."],
        ],
    },
    {
        id: "agents", title: "CLI and agents",
        summary: "Everything in the shell is scriptable. The CLI is for people and CI; the MCP server is for AI agents.",
        items: [
            ["gamelab", "Open the shell with the game picker."],
            ["gamelab serve <folder|url>", "Serve or proxy a game and print the shell URL. --open launches the browser; --profile picks a device."],
            ["gamelab run / headroom / export", "Scenario runs, CPU headroom sweeps, CI export (see \"lab\")."],
            ["gamelab guide [topic]", "This guide. `gamelab guide --list` lists topics; `gamelab guide memory` prints one."],
            ["gamelab mcp", "Run as an MCP server. `gamelab config claude|cursor|copilot|codex|gemini|vscode` prints the setup snippet."],
            ["What agents can read", "get_logs (Console), get_metrics / get_stats / get_load_timeline (Perf), get_history (Timeline), profile, get_game_state, screenshot, headroom, trace_start/stop, guide."],
            ["What agents can do", "press_key, click, touch, gamepad, game_command, eval, reload, set_viewport, lab_open, set_throttle, run_scenario, export_test."],
            ["Data lifetime", "History and logs live in the open page. Reloading the shell clears them — read them before reloading."],
        ],
    },
    {
        id: "caveats", title: "Accuracy and caveats",
        summary: "Where the numbers come from and when not to trust them.",
        items: [
            ["Headless and software rendering", "Headless Chromium renders with SwiftShader on the CPU: FPS is far lower, GPU timing is unavailable, and main-thread time can exceed the frame. Use it for relative comparisons and correctness, not absolute numbers."],
            ["GPU timing", "Needs desktop Chrome/Edge with WebGL2 and the timer-query extension. Safari and Firefox don't expose it."],
            ["Heap", "performance.memory exists only in Chromium browsers."],
            ["Profiler", "Needs a Chromium browser; gamelab sends the required Document-Policy header itself."],
            ["Display refresh", "Verdicts assume a 60 Hz display. On 120 Hz screens the frame budget is 8.3 ms."],
            ["Emulation in the shell", "In the shell, device profiles change resolution, pixel ratio, user agent and touch, but not CPU or GPU speed. Use the lab for CPU and network throttling."],
            ["Observer effect", "The injected script wraps WebGL calls to count them, which adds a little CPU time per call. Compare builds under the same conditions."],
        ],
    },
];

const byId = new Map(GUIDE.map((s) => [s.id, s]));

/** Find a section by id, title word, or a term inside it. */
export function findTopic(q) {
    if (!q) return null;
    const k = String(q).toLowerCase().trim();
    if (byId.has(k)) return byId.get(k);
    const aliases = { cpu: "cpu-gpu", gpu: "cpu-gpu", bottleneck: "cpu-gpu", verdict: "cpu-gpu", fps: "frame", frames: "frame", hitch: "hitches", "long tasks": "hitches", probe: "game", engine: "game", cli: "agents", mcp: "agents", devices: "lab", headroom: "lab", throttle: "lab", ui: "shell", header: "shell", graph: "timeline" };
    if (aliases[k]) return byId.get(aliases[k]);
    return GUIDE.find((s) => s.title.toLowerCase().includes(k) || (s.perf || "").toLowerCase() === k)
        || GUIDE.find((s) => s.items.some(([t]) => t.toLowerCase().includes(k)))
        || null;
}

// ---- plain-text rendering (CLI, MCP) -------------------------------------------

function wrap(text, width, indent = "") {
    const out = []; let line = indent;
    for (const word of String(text).split(/\s+/)) {
        if (line.trim() && (line + word).length > width) { out.push(line.trimEnd()); line = indent; }
        line += word + " ";
    }
    if (line.trim()) out.push(line.trimEnd());
    return out.join("\n");
}

export function sectionText(s, { width = 88, color = false } = {}) {
    const b = (t) => (color ? `\x1b[1m${t}\x1b[22m` : t), d = (t) => (color ? `\x1b[2m${t}\x1b[22m` : t);
    const lines = [b(s.title.toUpperCase()) + d(`  (gamelab guide ${s.id})`), wrap(s.summary, width), ""];
    if (s.steps) { s.steps.forEach((st, i) => lines.push(wrap(st, width, "     ").replace(/^ {5}/, `  ${i + 1}. `))); lines.push(""); }
    const tw = Math.min(30, Math.max(...s.items.map(([t]) => t.length)) + 2);
    for (const [term, text] of s.items) {
        if (term.length + 2 <= tw && width - tw > 30) {
            const body = wrap(text, width, " ".repeat(tw + 2)).slice(tw + 2);
            lines.push("  " + b(term.padEnd(tw)) + body);
        } else {
            lines.push("  " + b(term));
            lines.push(wrap(text, width, "      "));
        }
    }
    if (s.id === "start") {
        lines.push("", b("  Examples to try") + d("  (also in the Open dialog)"));
        for (const e of EXAMPLES) lines.push(`    ${e.name.padEnd(36)} ${d(e.url)}`);
    }
    return lines.join("\n");
}

export function guideText(topic, opts = {}) {
    if (topic) {
        const s = findTopic(topic);
        if (!s) return `No guide topic matches "${topic}".\n\n` + topicList(opts);
        return sectionText(s, opts);
    }
    return GUIDE.map((s) => sectionText(s, opts)).join("\n\n");
}

export function topicList({ color = false } = {}) {
    const b = (t) => (color ? `\x1b[1m${t}\x1b[22m` : t);
    return "Topics (gamelab guide <topic>):\n" + GUIDE.map((s) => `  ${b(s.id.padEnd(10))} ${s.title}`).join("\n");
}
