// Game delivery layer: static serving of a built web game directory (with
// MIME types, Content-Encoding for Unity .br/.gz artifacts and optional
// COOP/COEP isolation headers), or a reverse proxy in front of a running dev
// server (Vite, Phaser, Godot's built-in server, …) or a deployed game over
// https, including WebSocket upgrades so HMR / multiplayer keep working. HTML
// responses get the hook script injected (decompressing gzip/br first) and,
// for remote targets, have CSP / HSTS stripped and same-origin absolute URLs
// pointed back at the proxy so every asset still flows through it.

import { createReadStream } from "node:fs";
import { stat, readFile, readdir } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import path from "node:path";
import { gunzipSync, brotliDecompressSync, inflateSync, inflateRawSync } from "node:zlib";

export const HOOK_PATH = "/__gp/hook.js";

const MIME = {
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml", ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".ico": "image/x-icon", ".avif": "image/avif", ".ktx2": "image/ktx2",
    ".ogg": "audio/ogg", ".oga": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav",
    ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac",
    ".mp4": "video/mp4", ".webm": "video/webm",
    ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
    ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
    ".pck": "application/octet-stream", ".data": "application/octet-stream",
    ".bin": "application/octet-stream", ".unityweb": "application/octet-stream",
    ".bundle": "application/octet-stream", ".atlas": "text/plain; charset=utf-8",
};

const ISOLATION_HEADERS = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
};

function contentHeaders(file) {
    let ext = path.extname(file).toLowerCase();
    const headers = {};
    if (ext === ".br" || ext === ".gz") {
        headers["Content-Encoding"] = ext === ".br" ? "br" : "gzip";
        ext = path.extname(file.slice(0, -ext.length)).toLowerCase();
    }
    headers["Content-Type"] = MIME[ext] || "application/octet-stream";
    return headers;
}

export function applyIsolation(headers, enabled) {
    if (enabled) Object.assign(headers, ISOLATION_HEADERS);
    return headers;
}

export function injectHook(html) {
    const tag = `<script src="${HOOK_PATH}"></script>`;
    if (html.includes(HOOK_PATH)) return html;
    const head = html.match(/<head[^>]*>/i);
    if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
    const script = html.search(/<script[\s>]/i);
    if (script >= 0) return html.slice(0, script) + tag + html.slice(script);
    const htmlTag = html.match(/<html[^>]*>/i);
    if (htmlTag) return html.slice(0, htmlTag.index + htmlTag[0].length) + tag + html.slice(htmlTag.index + htmlTag[0].length);
    return tag + html;
}

/** Pick the HTML entry for a built game directory (index.html, or the lone / Godot-named .html). */
export async function detectEntry(dir) {
    const names = await readdir(dir);
    if (names.includes("index.html")) return "index.html";
    const htmls = names.filter((n) => /\.html?$/i.test(n));
    if (htmls.length === 1) return htmls[0];
    const pck = names.find((n) => n.endsWith(".pck"));
    if (pck) {
        const match = htmls.find((n) => n.replace(/\.html?$/i, "") === pck.slice(0, -4));
        if (match) return match;
    }
    if (htmls.length) return htmls.sort()[0];
    return null;
}

/** Heuristic: Godot / Unity style exports benefit from cross-origin isolation. */
export async function looksLikeWasmExport(dir) {
    try {
        const names = await readdir(dir);
        if (names.some((n) => /\.(pck|wasm)(\.br|\.gz)?$/i.test(n))) return true;
        if (names.includes("Build")) {
            const build = await readdir(path.join(dir, "Build"));
            return build.some((n) => /\.wasm(\.br|\.gz)?$/i.test(n));
        }
    } catch { /* ignore */ }
    return false;
}

function send(res, status, body, headers = {}) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(body);
}

export async function serveStatic(req, res, { dir, isolation }) {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, "Bad path"); }
    let file = path.resolve(dir, "." + rel);
    if (file !== dir && !file.startsWith(dir + path.sep)) return send(res, 403, "Forbidden");

    let info;
    try { info = await stat(file); } catch { return send(res, 404, `Not found: ${rel}`); }
    if (info.isDirectory()) {
        file = path.join(file, "index.html");
        try { info = await stat(file); } catch { return send(res, 404, `No index.html in ${rel}`); }
    }

    const headers = applyIsolation({ ...contentHeaders(file), "Cache-Control": "no-store", "Accept-Ranges": "bytes" }, isolation);
    if (headers["Content-Type"].startsWith("text/html") && !headers["Content-Encoding"]) {
        const html = injectHook(await readFile(file, "utf8"));
        headers["Content-Length"] = Buffer.byteLength(html);
        headers["Document-Policy"] = "js-profiling"; // enables the JS Self-Profiling API used by the hook's profile()
        res.writeHead(200, headers);
        return res.end(req.method === "HEAD" ? undefined : html);
    }

    // Minimal Range support: media elements and some loaders probe with ranges.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        if (start > end || start >= info.size) return send(res, 416, "Range not satisfiable", { "Content-Range": `bytes */${info.size}` });
        headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
        headers["Content-Length"] = end - start + 1;
        res.writeHead(206, headers);
        if (req.method === "HEAD") return res.end();
        return createReadStream(file, { start, end }).pipe(res);
    }

    headers["Content-Length"] = info.size;
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"]);

export const isLoopback = (hostname) => /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i.test(hostname);
const targetPort = (target) => Number(target.port) || (target.protocol === "https:" ? 443 : 80);

function decode(buf, encoding) {
    switch ((encoding || "").toLowerCase()) {
        case "gzip": case "x-gzip": return gunzipSync(buf);
        case "br": return brotliDecompressSync(buf);
        case "deflate": try { return inflateSync(buf); } catch { return inflateRawSync(buf); }
        default: return buf;
    }
}

// Remote HTML: drop CSP (it would block the injected hook), point absolute
// same-origin URLs at the proxy so wasm/pck fetches stay same-origin.
function rewriteRemoteHtml(html, target, proxyOrigin) {
    html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
    const host = target.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp("https?://" + host + "(?=[/\"'\\s?#])", "g"), proxyOrigin);
    html = html.replace(new RegExp("(?<=[\"'(=\\s])//" + host + "(?=[/\"'\\s?#])", "g"), proxyOrigin);
    return html;
}

export function proxyRequest(req, res, { target, isolation }) {
    const remote = !isLoopback(target.hostname);
    const proxyOrigin = "http://" + (req.headers.host || "127.0.0.1");
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    headers.host = target.host;
    if (!remote) headers["accept-encoding"] = "identity"; // dev servers: keep HTML injectable without decoding
    if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, target.origin);
    if (headers.origin) headers.origin = target.origin;
    if (remote) headers["accept-encoding"] = "gzip, deflate, br";

    const mod = target.protocol === "https:" ? https : http;
    const upstream = mod.request({ hostname: target.hostname, port: targetPort(target), servername: target.hostname, method: req.method, path: req.url, headers }, (ures) => {
        const out = {};
        for (const [k, v] of Object.entries(ures.headers)) if (!HOP_BY_HOP.has(k)) out[k] = v;
        delete out["x-frame-options"];
        if (remote) {
            delete out["content-security-policy"]; delete out["content-security-policy-report-only"];
            delete out["strict-transport-security"]; delete out["report-to"]; delete out["nel"];
            // the browser talks to us over plain http on localhost: keep cookies scoped to the proxy
            if (out["set-cookie"]) out["set-cookie"] = [].concat(out["set-cookie"]).map((c) => c.replace(/;\s*(domain=[^;]*|secure)/gi, "").replace(/;\s*samesite=none/gi, "; SameSite=Lax"));
            if (out.location) out.location = String(out.location).replace(target.origin, proxyOrigin);
        }
        applyIsolation(out, isolation);
        out["cache-control"] = "no-store";

        const type = String(ures.headers["content-type"] || "");
        const enc = ures.headers["content-encoding"];
        if (type.includes("text/html") && (!enc || remote)) {
            const chunks = [];
            ures.on("data", (c) => chunks.push(c));
            ures.on("end", () => {
                let html;
                try { html = decode(Buffer.concat(chunks), enc).toString("utf8"); }
                catch { res.writeHead(502, { "Content-Type": "text/plain" }); return res.end("gamelab: could not decode " + enc + " HTML from " + target.origin); }
                if (remote) html = rewriteRemoteHtml(html, target, proxyOrigin);
                html = injectHook(html);
                delete out["content-encoding"];
                out["content-length"] = Buffer.byteLength(html);
                out["document-policy"] = "js-profiling";
                res.writeHead(ures.statusCode || 200, out);
                res.end(html);
            });
            ures.on("error", () => { try { res.destroy(); } catch { /* ignore */ } });
            return;
        }
        res.writeHead(ures.statusCode || 200, out);
        ures.pipe(res);
    });
    upstream.on("error", (err) => {
        if (res.headersSent) return res.destroy();
        const body = `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;color:#ddd;background:#111;padding:24px">
<h2 style="margin:0 0 8px">Cannot reach <code>${target.origin}</code></h2>
<p>${escapeHtml(err.message)}</p><p>${remote ? "Check the URL and your connection. This page retries every 5s." : "Is the dev server running? This page retries every 2s."}</p>
<script>setTimeout(()=>location.reload(),${remote ? 5000 : 2000})</script></body>`;
        res.writeHead(502, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(body);
    });
    req.pipe(upstream);
}

export function proxyUpgrade(req, socket, head, { target }) {
    const port = targetPort(target);
    const connect = (cb) => target.protocol === "https:" ? tls.connect({ host: target.hostname, port, servername: target.hostname }, cb) : net.connect(port, target.hostname, cb);
    const upstream = connect(() => {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            const key = req.rawHeaders[i];
            let value = req.rawHeaders[i + 1];
            const lower = key.toLowerCase();
            if (lower === "host") value = target.host;
            else if (lower === "origin") value = target.origin;
            lines.push(`${key}: ${value}`);
        }
        upstream.write(lines.join("\r\n") + "\r\n\r\n");
        if (head?.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
    });
    const kill = () => { try { socket.destroy(); } catch { /* ignore */ } try { upstream.destroy(); } catch { /* ignore */ } };
    upstream.on("error", kill);
    socket.on("error", kill);
}

export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
