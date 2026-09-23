// MCP server (stdio): exposes the tool catalogue to any MCP-capable agent —
// Claude Code, Cursor, Windsurf, Codex CLI, Gemini CLI, Copilot CLI, ...
//
// Adds three lifecycle tools on top of tools.mjs: open, close, list. Every
// other tool takes an optional `instance` (defaults to the most recent one).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { openPreview, GameLabError } from "./preview.mjs";
import { TOOLS, OPEN_INPUT_SCHEMA, callTool } from "./tools.mjs";
import { createRequire } from "node:module";

const { version } = createRequire(import.meta.url)("../package.json");

const INSTANCE_PROP = { type: "string", description: "Preview instance id from `open`. Defaults to the most recently opened preview." };

function withInstance(schema) {
    return { ...schema, properties: { ...(schema.properties ?? {}), instance: INSTANCE_PROP } };
}

function text(obj) {
    return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

export async function startMcpServer({ filesDir, cwd = process.cwd(), log = (m) => process.stderr.write(m + "\n") } = {}) {
    const previews = new Map();
    let current = null;

    const pick = (id) => {
        const p = id ? previews.get(id) : current;
        if (!p) throw new GameLabError(id ? "unknown_instance" : "no_instance", id ? `No preview instance "${id}". Call list.` : "No preview is open. Call `open` with a dir or url first.");
        return p;
    };

    const lifecycle = [
        {
            name: "open",
            description: "Serve a built web game folder (Godot/Unity/Phaser/etc. export) or proxy a running dev server, with the gamelab hook injected for console/FPS/WebGL capture. Returns the instance id, a shell URL a human can open in a browser to watch/play (that browser becomes the `panel` target), and the direct game URL. Then use lab_open for automated, trusted-input testing.",
            inputSchema: { ...OPEN_INPUT_SCHEMA, properties: { ...OPEN_INPUT_SCHEMA.properties, instance: { type: "string", description: "Optional id to (re)use for this preview." } } },
            handler: async (input) => {
                const { instance, ...rest } = input ?? {};
                if (instance && previews.has(instance)) { await previews.get(instance).close(); previews.delete(instance); }
                const p = await openPreview(rest, { id: instance, cwd, filesDir, log, defaultTarget: "auto" });
                previews.set(p.id, p);
                current = p;
                return { ...p.info(), hint: "No browser is attached yet. Either open `url` in a browser to watch and play (panel target), or call lab_open to drive a Playwright Chromium (lab target). Tools default to target=auto (lab if running, else panel)." };
            },
        },
        {
            name: "close",
            description: "Stop a preview (its server, watcher and lab browser).",
            inputSchema: { type: "object", properties: { instance: INSTANCE_PROP }, additionalProperties: false },
            handler: async (input) => {
                const p = pick(input?.instance);
                await p.close();
                previews.delete(p.id);
                if (current === p) current = [...previews.values()].at(-1) ?? null;
                return { closed: p.id };
            },
        },
        {
            name: "list",
            description: "List open preview instances.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            handler: async () => ({ current: current?.id ?? null, instances: [...previews.values()].map((p) => p.info()) }),
        },
    ];

    const server = new Server({ name: "gamelab", version }, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            ...lifecycle.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
            ...TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: withInstance(inputSchema) })),
        ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const { name, arguments: args = {} } = req.params;
        try {
            const life = lifecycle.find((t) => t.name === name);
            if (life) return text(await life.handler(args));

            const { instance, ...input } = args;
            const p = pick(instance);
            const result = await callTool(p, name, input);

            if (name === "screenshot" && result?.path) {
                const png = await readFile(result.path);
                return { content: [{ type: "text", text: JSON.stringify(result) }, { type: "image", data: png.toString("base64"), mimeType: "image/png" }] };
            }
            return text(result ?? { ok: true });
        } catch (err) {
            const code = err instanceof GameLabError ? err.code : "error";
            return { isError: true, content: [{ type: "text", text: `${code}: ${String(err?.message ?? err).split("\n")[0]}` }] };
        }
    });

    const shutdown = async () => {
        for (const p of previews.values()) { try { await p.close(); } catch { /* ignore */ } }
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.stdin.on("close", shutdown);

    await server.connect(new StdioServerTransport());
    log(`gamelab mcp v${version} ready (artifacts → ${filesDir ?? path.join(cwd, ".gamelab")})`);
    return server;
}
