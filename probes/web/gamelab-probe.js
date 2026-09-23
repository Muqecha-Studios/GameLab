/*
 * gamelab probe — the contract between a web game and gamelab (or any test harness).
 *
 * The game exposes `window.__game`:
 *   state()            → plain object describing the game right now (scene, phase, score, lap, …)
 *   metrics()          → plain object of engine-side numbers (processMs, physicsMs, entities, …)
 *   command(name,args) → optional: let tests drive the game without UI (start_race, set_seed, …)
 *   engine, version    → optional strings shown in the Perf tab
 * and emits:
 *   performance.mark(name)                                       → load-phase marks ("level_loaded")
 *   window.dispatchEvent(new CustomEvent("gamelab", {detail}))   → gameplay events ({type:"event", name, data, t})
 *
 * Well-known metric keys (colour-coded against the frame budget in the Perf tab):
 *   processMs, physicsMs, renderMs, scriptMs, gcAllocKB, entities, nodes, orphanNodes, drawCalls, textureMB
 * Anything else is shown as-is.
 *
 * Usage (Phaser / PixiJS / Three.js / vanilla):
 *   import GameLabProbe from "@muqecha/gamelab/probes/web/gamelab-probe.js";  // bundlers (UMD) — or <script src=…> → window.GameLabProbe
 *   const { installProbe } = GameLabProbe;
 *   const probe = installProbe({
 *     engine: "phaser", version: Phaser.VERSION,
 *     state:   () => ({ scene: game.scene.getScenes(true)[0]?.scene.key, phase, score }),
 *     metrics: () => ({ entities: scene.children.length, drawCalls: renderer.info.render.calls }),
 *     onCommand: (name, args) => { if (name === "start") startGame(args); },
 *   });
 *   probe.mark("level_loaded");
 *   probe.event("enemy_killed", { type: "drone" });
 *   probe.setState({ phase: "playing" });   // merged into state() when you don't pass a state() function
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.GameLabProbe = factory();
})(typeof self !== "undefined" ? self : this, function () {
    function installProbe(opts) {
        opts = opts || {};
        var merged = {}, g = (typeof window !== "undefined" ? window : self).__game = {
            engine: opts.engine || null,
            version: opts.version || null,
            state: function () { return typeof opts.state === "function" ? opts.state() : merged; },
            metrics: function () { return typeof opts.metrics === "function" ? opts.metrics() : {}; },
            command: function (name, args) {
                if (typeof opts.onCommand !== "function") throw new Error("game has no command handler");
                return opts.onCommand(name, args == null ? null : args);
            },
        };
        var api = {
            setState: function (patch) { for (var k in patch) merged[k] = patch[k]; return merged; },
            mark: function (name) { try { performance.mark(name); } catch (e) {} },
            event: function (name, data) { try { window.dispatchEvent(new CustomEvent("gamelab", { detail: { type: "event", name: name, data: data == null ? null : data, t: performance.now() } })); } catch (e) {} },
            game: g,
        };
        g.mark = api.mark; g.event = api.event;
        return api;
    }
    return { installProbe: installProbe };
});
