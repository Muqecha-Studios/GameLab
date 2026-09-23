// Backend for the shell's "Open a game" launcher: recent sources
// (~/.gamelab/recents.json), a directory lister that flags folders holding a
// web build, and the OS-native folder picker (osascript / PowerShell / zenity).

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { detectEntry } from "./server.mjs";

const HOME = () => process.env.GAMELAB_HOME || path.join(os.homedir(), ".gamelab");
export const RECENTS_PATH = () => path.join(HOME(), "recents.json");
const MAX_RECENTS = 12;

export async function readRecents() {
    try {
        const list = JSON.parse(await readFile(RECENTS_PATH(), "utf8"));
        return Array.isArray(list) ? list.filter((r) => r && (r.kind === "dir" || r.kind === "url") && typeof r.value === "string") : [];
    } catch { return []; }
}

export async function addRecent(kind, value) {
    const list = (await readRecents()).filter((r) => !(r.kind === kind && r.value === value));
    list.unshift({ kind, value, at: Date.now() });
    try {
        await mkdir(HOME(), { recursive: true });
        await writeFile(RECENTS_PATH(), JSON.stringify(list.slice(0, MAX_RECENTS), null, 2));
    } catch { /* recents are best-effort */ }
}

export async function removeRecent(kind, value) {
    const list = (await readRecents()).filter((r) => !(r.kind === kind && r.value === value));
    try { await writeFile(RECENTS_PATH(), JSON.stringify(list, null, 2)); } catch { /* ignore */ }
    return list;
}

async function entryOf(dir) {
    try { return await detectEntry(dir); } catch { return null; }
}

/** List sub-folders of `dir`, marking the ones that contain a web build. */
export async function listDir(dir) {
    const abs = path.resolve(dir);
    const st = await stat(abs);
    if (!st.isDirectory()) throw new Error(`Not a folder: ${abs}`);
    const names = await readdir(abs, { withFileTypes: true });
    const dirs = names.filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith(".") && d.name !== "node_modules").map((d) => d.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    const capped = dirs.slice(0, 400);
    const entries = await Promise.all(capped.map(async (name) => {
        const full = path.join(abs, name);
        try { if (!(await stat(full)).isDirectory()) return null; } catch { return null; }
        return { name, path: full, entry: await entryOf(full) };
    }));
    const parent = path.dirname(abs);
    return { path: abs, parent: parent === abs ? null : parent, entry: await entryOf(abs), dirs: entries.filter(Boolean), truncated: dirs.length > capped.length };
}

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 10 * 60 * 1000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim())));
    });
}

export const PICKER_AVAILABLE = process.platform === "darwin" || process.platform === "win32" || process.platform === "linux";

/** Open the OS folder dialog. Resolves to a path, or null if cancelled. */
export async function pickFolder(startDir) {
    try {
        if (process.platform === "darwin") {
            const loc = startDir ? ` default location (POSIX file ${JSON.stringify(startDir)})` : "";
            const p = await run("osascript", ["-e", `POSIX path of (choose folder with prompt "Choose a web game build folder"${loc})`]);
            return p.split("\n")[0].replace(/\/$/, "") || null;
        }
        if (process.platform === "win32") {
            const ps = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose a web game build folder'; " + (startDir ? `$d.SelectedPath = ${JSON.stringify(startDir)}; ` : "") + "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }";
            return (await run("powershell", ["-NoProfile", "-STA", "-Command", ps])) || null;
        }
        return (await run("zenity", ["--file-selection", "--directory", "--title=Choose a web game build folder", ...(startDir ? [`--filename=${startDir}/`] : [])])) || null;
    } catch (err) {
        // osascript exits 1 with "User canceled" (-128); zenity exits 1 on cancel.
        if (/-128|cancel/i.test(String(err?.message)) || err?.code === 1) return null;
        throw new Error(`Folder picker unavailable: ${err?.message ?? err}`);
    }
}
