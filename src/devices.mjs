// Device profiles: a resolution plus the device parameters that change how a
// web game performs (DPR, touch, mobile UA, CPU slowdown, network). Seeded
// profiles ship with gamelab; users add or override profiles in
// ~/.gamelab/devices.json (or $GAMELAB_HOME/devices.json). The shell, the lab,
// the MCP tools, the CLI and the Playwright export all read the same list.

import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const DEVICE_GROUPS = ["phone", "tablet", "handheld", "desktop", "embed", "custom"];
export const GROUP_LABELS = { phone: "Phones", tablet: "Tablets", handheld: "Handhelds & laptops", desktop: "Desktop", embed: "Portal embeds", custom: "Custom" };

const UA = {
    ios: (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v}_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v}.0 Mobile/15E148 Safari/604.1`,
    ipad: (v) => `Mozilla/5.0 (iPad; CPU OS ${v}_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v}.0 Mobile/15E148 Safari/604.1`,
    android: (model) => `Mozilla/5.0 (Linux; Android 14; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36`,
    androidTablet: (model) => `Mozilla/5.0 (Linux; Android 14; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`,
    steamdeck: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    chromeos: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

/**
 * A profile. `cpu` is a Chrome CPU throttling rate (1 = none, 4 = 4× slower);
 * `network` is a lab network preset name. `pw` names the closest Playwright
 * device descriptor for the lab / export so mobile UA + touch come from
 * Playwright's own table when available.
 */
export const SEEDED_DEVICES = [
    { id: "iphone-se", name: "iPhone SE", group: "phone", width: 375, height: 667, dpr: 2, touch: true, mobile: true, ua: UA.ios(17), cpu: 4, network: "4g", cores: 6, memoryGB: 4, pw: "iPhone SE", note: "Smallest current iPhone; A15, slow for its class" },
    { id: "iphone-15", name: "iPhone 15", group: "phone", width: 393, height: 852, dpr: 3, touch: true, mobile: true, ua: UA.ios(17), cpu: 2, network: "wifi", cores: 6, memoryGB: 6, pw: "iPhone 15", note: "Mainstream iPhone; 3× DPR triples fill cost" },
    { id: "iphone-15-pro-max", name: "iPhone 15 Pro Max", group: "phone", width: 430, height: 932, dpr: 3, touch: true, mobile: true, ua: UA.ios(17), cpu: 1, network: "wifi", cores: 6, memoryGB: 8, pw: "iPhone 15 Pro Max", note: "Largest iPhone canvas at 3× DPR" },
    { id: "pixel-7", name: "Pixel 7", group: "phone", width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, ua: UA.android("Pixel 7"), cpu: 2, network: "wifi", cores: 8, memoryGB: 8, pw: "Pixel 7", note: "Mid/high Android reference" },
    { id: "galaxy-s23", name: "Galaxy S23", group: "phone", width: 360, height: 780, dpr: 3, touch: true, mobile: true, ua: UA.android("SM-S911B"), cpu: 2, network: "wifi", cores: 8, memoryGB: 8, note: "Narrow 360 CSS px layout, 3× DPR" },
    { id: "budget-android", name: "Budget Android", group: "phone", width: 360, height: 800, dpr: 2, touch: true, mobile: true, ua: UA.android("moto g play"), cpu: 6, network: "fast-3g", cores: 4, memoryGB: 3, note: "~$150 phone: 4 slow cores, 3 GB, patchy network — your real floor" },
    { id: "ipad", name: "iPad (10th gen)", group: "tablet", width: 820, height: 1180, dpr: 2, touch: true, mobile: true, ua: UA.ipad(17), cpu: 2, network: "wifi", cores: 6, memoryGB: 4, pw: "iPad (gen 7)", note: "Tablet aspect; large canvas at 2×" },
    { id: "ipad-pro-13", name: "iPad Pro 13\"", group: "tablet", width: 1024, height: 1366, dpr: 2, touch: true, mobile: true, ua: UA.ipad(17), cpu: 1, network: "wifi", cores: 8, memoryGB: 8, pw: "iPad Pro 11", note: "Biggest mobile canvas: 2048×2732 device px" },
    { id: "galaxy-tab", name: "Galaxy Tab A9", group: "tablet", width: 800, height: 1280, dpr: 2, touch: true, mobile: true, ua: UA.androidTablet("SM-X210"), cpu: 4, network: "wifi", cores: 8, memoryGB: 4, note: "Budget Android tablet" },
    { id: "steam-deck", name: "Steam Deck", group: "handheld", width: 1280, height: 800, dpr: 1, touch: true, mobile: false, ua: UA.steamdeck, cpu: 2, network: "wifi", cores: 8, memoryGB: 16, note: "Gamepad-first; 16:10 at 1×" },
    { id: "chromebook", name: "Chromebook", group: "handheld", width: 1366, height: 768, dpr: 1, touch: false, mobile: false, ua: UA.chromeos, cpu: 3, network: "wifi", cores: 4, memoryGB: 4, note: "School/office laptop; weak iGPU" },
    { id: "laptop", name: "Laptop 14\" Retina", group: "desktop", width: 1440, height: 900, dpr: 2, touch: false, mobile: false, cpu: 1, network: "wifi", cores: 8, memoryGB: 16, note: "Typical dev machine — the number you already know" },
    { id: "desktop-1080p", name: "Desktop 1080p", group: "desktop", width: 1920, height: 1080, dpr: 1, touch: false, mobile: false, cpu: 1, network: "wifi", cores: 8, memoryGB: 16, note: "Most common desktop resolution" },
    { id: "desktop-4k", name: "Desktop 4K", group: "desktop", width: 1920, height: 1080, dpr: 2, touch: false, mobile: false, cpu: 1, network: "wifi", cores: 12, memoryGB: 32, note: "3840×2160 device px — 4× the fill of 1080p" },
    { id: "itch-embed", name: "itch.io embed", group: "embed", width: 960, height: 640, dpr: 1, touch: false, mobile: false, cpu: 1, network: "wifi", cores: 8, memoryGB: 16, note: "Default itch.io iframe size" },
    { id: "portal-embed", name: "Portal embed 16:9", group: "embed", width: 1280, height: 720, dpr: 1, touch: false, mobile: false, cpu: 2, network: "4g", cores: 8, memoryGB: 8, note: "Poki / CrazyGames style 720p iframe" },
];

const HOME = () => process.env.GAMELAB_HOME || path.join(os.homedir(), ".gamelab");
export const USER_DEVICES_PATH = () => path.join(HOME(), "devices.json");

const FIELDS = {
    width: [200, 7680], height: [200, 4320], dpr: [0.5, 4], cpu: [1, 20], cores: [1, 64], memoryGB: [0.25, 256],
};

export function slugify(name) {
    return String(name).toLowerCase().replace(/["']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "device";
}

/** Validate + normalize a profile from user input. Throws on bad values. */
export function normalizeDevice(input, { requireId = false } = {}) {
    if (!input || typeof input !== "object") throw new Error("Device profile must be an object");
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("Device profile needs a name");
    const id = String(input.id ?? slugify(name)).trim();
    if (requireId && !input.id) throw new Error("Device profile needs an id");
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error(`Bad device id "${id}" (lowercase letters, digits, dashes)`);
    const out = { id, name, group: DEVICE_GROUPS.includes(input.group) ? input.group : "custom" };
    for (const [k, [min, max]] of Object.entries(FIELDS)) {
        let v = input[k];
        if (v === undefined || v === null || v === "") {
            if (k === "width" || k === "height") throw new Error(`Device profile needs ${k}`);
            v = k === "dpr" || k === "cpu" ? 1 : k === "cores" ? 8 : 8;
        }
        v = Number(v);
        if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${k} must be between ${min} and ${max}`);
        out[k] = k === "width" || k === "height" || k === "cores" ? Math.round(v) : Math.round(v * 1000) / 1000;
    }
    out.touch = !!input.touch;
    out.mobile = !!input.mobile;
    out.ua = input.ua ? String(input.ua).slice(0, 400) : undefined;
    out.network = input.network ? String(input.network) : "none";
    out.note = input.note ? String(input.note).slice(0, 200) : undefined;
    if (input.pw) out.pw = String(input.pw);
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
}

export async function loadUserDevices() {
    try {
        const raw = JSON.parse(await readFile(USER_DEVICES_PATH(), "utf8"));
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.devices) ? raw.devices : [];
        return list.map((d) => { try { return normalizeDevice(d); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
}

export async function saveUserDevices(list) {
    const devices = list.map((d) => normalizeDevice(d));
    await mkdir(HOME(), { recursive: true });
    await writeFile(USER_DEVICES_PATH(), JSON.stringify({ $schema: "gamelab-devices/1", devices }, null, 2) + "\n");
    return devices;
}

/** Seeded + user profiles; a user profile with a seeded id overrides the seed. */
export async function allDevices() {
    const user = await loadUserDevices();
    const byId = new Map(SEEDED_DEVICES.map((d) => [d.id, { ...d, seeded: true }]));
    for (const d of user) byId.set(d.id, { ...d, user: true, overrides: byId.has(d.id) && byId.get(d.id).seeded });
    return [...byId.values()];
}

export async function upsertUserDevice(profile) {
    const d = normalizeDevice(profile);
    const user = await loadUserDevices();
    const i = user.findIndex((x) => x.id === d.id);
    if (i >= 0) user[i] = d; else user.push(d);
    await saveUserDevices(user);
    return d;
}

/** Remove a user profile; a seeded id reverts to the seed. Returns true if something was removed. */
export async function deleteUserDevice(id) {
    const user = await loadUserDevices();
    const next = user.filter((x) => x.id !== id);
    if (next.length === user.length) return false;
    await saveUserDevices(next);
    return true;
}

/** Find a profile by id or (case-insensitive) name. */
export async function resolveDevice(idOrName) {
    if (!idOrName) return null;
    const list = await allDevices();
    const q = String(idOrName).toLowerCase();
    return list.find((d) => d.id === q) || list.find((d) => d.name.toLowerCase() === q) || null;
}

/** Legacy shell viewport map (kept for `set_viewport` / `open { viewport }` compatibility). */
export const VIEWPORTS = Object.fromEntries([
    ["fill", null],
    ["1920x1080", [1920, 1080]], ["1280x720", [1280, 720]], ["960x540", [960, 540]], ["800x600", [800, 600]],
    ...SEEDED_DEVICES.map((d) => [d.id, [d.width, d.height]]),
    // old aliases
    ["iphone", [393, 852]], ["android", [412, 915]], ["ipad", [820, 1180]], ["steamdeck", [1280, 800]],
]);

/** What the in-page hook should emulate for a profile (things a page can fake about itself). */
export function emulationFor(profile, { rotated = false } = {}) {
    if (!profile) return null;
    const w = rotated ? profile.height : profile.width, h = rotated ? profile.width : profile.height;
    return { id: profile.id, name: profile.name, width: w, height: h, dpr: profile.dpr, touch: !!profile.touch, mobile: !!profile.mobile, ua: profile.ua || null, cores: profile.cores, memoryGB: profile.memoryGB, cpu: profile.cpu, network: profile.network };
}

/** Options for Lab.open() / the Playwright export. */
export function labOptionsFor(profile, { landscape = false } = {}) {
    if (!profile) return {};
    return {
        device: profile.pw || undefined,
        width: profile.width, height: profile.height, landscape,
        deviceScaleFactor: profile.dpr, touch: !!profile.touch, isMobile: !!profile.mobile,
        userAgent: profile.ua || undefined,
        cpu: profile.cpu > 1 ? profile.cpu : undefined,
        network: profile.network && profile.network !== "none" && profile.network !== "wifi" ? profile.network : undefined,
    };
}

export function describeDevice(d) {
    const bits = [`${d.width}×${d.height}`, `dpr ${d.dpr}`];
    if (d.cpu > 1) bits.push(`cpu ×${d.cpu}`);
    if (d.network && d.network !== "none" && d.network !== "wifi") bits.push(d.network);
    if (d.touch) bits.push("touch");
    return bits.join(" · ");
}
