// Scripted test scenarios: a JSON list of steps run against a "driver" (the
// panel iframe via the shell command channel, or the Playwright lab). Produces
// a pass/fail report; export.mjs turns the same steps into a Playwright spec.

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

export const STEP_KINDS = ["wait", "waitFor", "waitForState", "assertState", "gameCommand", "waitForEvent", "key", "click", "tap", "swipe", "gamepad", "eval", "assert", "expectFps", "expectNoErrors", "expectNoHitches", "screenshot", "reload", "throttle", "visibility", "loseContext", "reset"];
const LAB_ONLY = new Set(["tap", "swipe", "gamepad", "throttle"]);

export const STEP_SCHEMA = {
    type: "object",
    properties: {
        do: { type: "string", enum: STEP_KINDS },
        note: { type: "string", description: "Free text shown in the report." },
        ms: { type: "integer", description: "wait: milliseconds to pause." },
        expr: { type: "string", description: "waitFor/assert: JS expression evaluated in the game page; truthy passes. waitForState/assertState: expression over `state`, `metrics` and `events` from the game probe (window.__game), e.g. \"state.phase === 'racing' && metrics.physicsMs < 4\"." },
        args: { description: "gameCommand: arguments passed to window.__game.command(name, args)." },
        event: { type: "string", description: "waitForEvent: name of a gameplay event the probe must emit (from now on)." },
        timeoutMs: { type: "integer", description: "waitFor: give up after (default 10000)." },
        key: { type: "string" }, holdMs: { type: "integer" }, times: { type: "integer", description: "key: repeat count (default 1)." }, gapMs: { type: "integer" },
        shift: { type: "boolean" }, ctrl: { type: "boolean" }, alt: { type: "boolean" }, meta: { type: "boolean" },
        x: { type: "number" }, y: { type: "number" }, x2: { type: "number" }, y2: { type: "number" }, unit: { type: "string", enum: ["px", "fraction"] }, durationMs: { type: "integer" },
        index: { type: "integer" }, buttons: { type: "object", additionalProperties: true }, axes: { type: "array", items: { type: ["number", "null"] } }, action: { type: "string" },
        code: { type: "string", description: "eval: JS to run (statements with return, or an expression)." },
        message: { type: "string", description: "assert: failure message." },
        min: { type: "number", description: "expectFps: minimum average fps over sampleMs." }, sampleMs: { type: "integer" },
        max: { type: "integer", description: "expectNoHitches: allowed hitch count (default 0)." }, maxFrameMs: { type: "number", description: "expectNoHitches: fail if any frame exceeded this." },
        name: { type: "string", description: "screenshot: file name. gameCommand: command name." },
        cpu: { type: "number" }, network: { type: ["string", "object"] },
        hidden: { type: ["boolean", "null"] }, restoreAfterMs: { type: ["integer", "null"] },
    },
    required: ["do"],
    additionalProperties: false,
};

const STATE_EXPR = (expr) => `{ const g = await window.__gp.gameState(); if (!g.present) throw new Error("no game probe (window.__game) on this page"); const state = g.state ?? {}, metrics = g.metrics ?? {}, events = g.events?.recent ?? []; return (${expr}\n); }`;
const FPS_SAMPLER = (ms) => `if (document.hidden) throw new Error("page is hidden (requestAnimationFrame is paused) — bring the panel into view or use the lab"); return await new Promise((resolve) => { let n = 0; const start = performance.now(); requestAnimationFrame(function f(t) { n++; if (t - start < ${ms}) requestAnimationFrame(f); else resolve(Math.round((n * 1000) / (t - start))); }); })`;

export async function runScenario(driver, scenario, { filesDir, log }) {
    const name = (scenario.name || "scenario").replace(/[^\w.-]+/g, "_");
    const stopOnFail = scenario.stopOnFail !== false;
    const started = Date.now();
    const results = [];
    const artifacts = [];
    let failed = 0, skipped = 0;

    if (scenario.clearLogs !== false) await driver.clearLogs().catch(() => {});
    if (scenario.resetHitches !== false) await driver.resetHitches().catch(() => {});

    for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const entry = { index: i, do: step.do, note: step.note };
        if (failed && stopOnFail) { entry.skipped = true; skipped++; results.push(entry); continue; }
        const t0 = Date.now();
        try {
            if (LAB_ONLY.has(step.do) && driver.name !== "lab") throw new Error(`"${step.do}" needs the lab browser (target: "lab" or lab_open first)`);
            entry.result = await runStep(driver, step, { name, i, artifacts });
            entry.ok = true;
        } catch (err) {
            entry.ok = false; entry.error = String(err?.message ?? err); failed++;
        }
        entry.ms = Date.now() - t0;
        results.push(entry);
    }

    const report = {
        name, target: driver.name, passed: failed === 0, durationMs: Date.now() - started,
        summary: { steps: scenario.steps.length, passed: results.filter((r) => r.ok).length, failed, skipped },
        steps: results, artifacts,
    };
    try {
        await mkdir(filesDir, { recursive: true });
        const file = path.join(filesDir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.report.json`);
        await writeFile(file, JSON.stringify(report, null, 2));
        report.reportPath = file;
    } catch (err) { log?.(`gamelab: could not write report: ${err.message}`, "warning"); }
    return report;
}

async function runStep(d, s, ctx) {
    switch (s.do) {
        case "wait": await d.wait(s.ms ?? 500); return { waitedMs: s.ms ?? 500 };
        case "waitFor": {
            const timeout = s.timeoutMs ?? 10000, interval = s.intervalMs ?? 100, start = Date.now();
            for (;;) {
                const v = await d.evaluate(s.expr, 5000).catch((e) => ({ __err: e.message }));
                if (v && !v.__err) return { value: v, afterMs: Date.now() - start };
                if (Date.now() - start > timeout) throw new Error(`waitFor timed out after ${timeout} ms: ${s.expr}${v?.__err ? ` (last error: ${v.__err})` : ""}`);
                await d.wait(interval);
            }
        }
        case "waitForState":
        case "assertState": {
            const code = STATE_EXPR(s.expr);
            if (s.do === "assertState") {
                const v = await d.evaluate(code, s.timeoutMs ?? 15000);
                if (!v) throw new Error(s.message || `state assertion failed: ${s.expr}`);
                return { value: v };
            }
            const timeout = s.timeoutMs ?? 10000, interval = s.intervalMs ?? 100, start = Date.now();
            for (;;) {
                const v = await d.evaluate(code, 5000).catch((e) => ({ __err: e.message }));
                if (v && !v.__err) return { value: v, afterMs: Date.now() - start };
                if (Date.now() - start > timeout) throw new Error(`waitForState timed out after ${timeout} ms: ${s.expr}${v?.__err ? ` (last error: ${v.__err})` : ""}`);
                await d.wait(interval);
            }
        }
        case "waitForEvent": {
            const timeout = s.timeoutMs ?? 10000, start = Date.now();
            const since = (await d.evaluate("(await window.__gp.gameState()).events.total")) ?? 0;
            for (;;) {
                const ev = await d.evaluate(`{ const g = await window.__gp.gameState(); const skip = Math.max(0, g.events.recent.length - (g.events.total - ${since})); return g.events.recent.slice(skip).find((e) => e.name === ${JSON.stringify(s.event)}) || null; }`, 5000).catch(() => null);
                if (ev) return { event: ev, afterMs: Date.now() - start };
                if (Date.now() - start > timeout) throw new Error(`waitForEvent timed out after ${timeout} ms: no "${s.event}" event from the game probe`);
                await d.wait(s.intervalMs ?? 100);
            }
        }
        case "gameCommand": return d.gameCommand(s.name, s.args);
        case "key": {
            const times = s.times ?? 1, out = [];
            for (let k = 0; k < times; k++) {
                out.push(await d.key({ key: s.key, holdMs: s.holdMs ?? 100, shift: s.shift, ctrl: s.ctrl, alt: s.alt, meta: s.meta }));
                if (k < times - 1) await d.wait(s.gapMs ?? 50);
            }
            return times === 1 ? out[0] : { times, last: out[out.length - 1] };
        }
        case "click": return d.click({ x: s.x, y: s.y, unit: s.unit, holdMs: s.holdMs });
        case "tap": return d.touch({ kind: "tap", x: s.x, y: s.y, unit: s.unit, durationMs: s.durationMs });
        case "swipe": return d.touch({ kind: "swipe", x: s.x, y: s.y, x2: s.x2, y2: s.y2, unit: s.unit, durationMs: s.durationMs });
        case "gamepad": return d.gamepad({ action: s.action, index: s.index, buttons: s.buttons, axes: s.axes, holdMs: s.holdMs });
        case "eval": return { value: await d.evaluate(s.code, s.timeoutMs ?? 15000) };
        case "assert": {
            const v = await d.evaluate(s.expr, s.timeoutMs ?? 15000);
            if (!v) throw new Error(s.message || `assertion failed: ${s.expr} → ${JSON.stringify(v)}`);
            return { value: v };
        }
        case "expectFps": {
            const sample = s.sampleMs ?? 2000;
            const fps = await d.evaluate(FPS_SAMPLER(sample), sample + 5000);
            if (fps < s.min) throw new Error(`fps ${fps} < ${s.min} over ${sample} ms`);
            return { fps, sampleMs: sample };
        }
        case "expectNoErrors": {
            const errors = await d.errorLogs();
            if (errors.length) throw new Error(`${errors.length} console error(s): ${errors.slice(0, 3).map((e) => e.text.slice(0, 160)).join(" | ")}`);
            return { errors: 0 };
        }
        case "expectNoHitches": {
            const m = await d.metrics();
            const hitches = m.hitches?.count ?? 0, worst = m.frame?.maxMs ?? 0;
            if (hitches > (s.max ?? 0)) throw new Error(`${hitches} frame hitch(es) > ${m.hitches.thresholdMs} ms (worst ${worst} ms): ${JSON.stringify(m.hitches.recent.slice(-3))}`);
            if (s.maxFrameMs && worst > s.maxFrameMs) throw new Error(`worst frame ${worst} ms > ${s.maxFrameMs} ms`);
            return { hitches, worstFrameMs: worst, p95Ms: m.frame?.p95Ms };
        }
        case "screenshot": {
            const shot = await d.screenshot(s.name || `${ctx.name}-step${ctx.i}`);
            ctx.artifacts.push({ kind: "screenshot", step: ctx.i, path: shot.path });
            return shot;
        }
        case "reload": return d.reload();
        case "throttle": return d.throttle({ cpu: s.cpu, network: s.network });
        case "visibility": return d.visibility(s.hidden ?? null);
        case "loseContext": return d.loseContext(s.restoreAfterMs ?? 1000);
        case "reset": await d.clearLogs(); await d.resetHitches(); return { reset: true };
        default: throw new Error(`Unknown step "${s.do}". Known: ${STEP_KINDS.join(", ")}`);
    }
}
