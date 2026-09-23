// Public API. Hosts embed gamelab with:
//   const p = await openPreview({ dir }, { filesDir, log });
//   await callTool(p, "lab_open", { device: "iPhone 14" });
//   const report = await callTool(p, "run_scenario", { steps: [...] });
export { Preview, openPreview, resolveConfig, GameLabError, labCall, expandHome, SHELL_PREFIX, CMD_TIMEOUT_MS, VIEWPORTS } from "./preview.mjs";
export { TOOLS, TOOLS_BY_NAME, callTool, OPEN_INPUT_SCHEMA, TARGET_PROP, STEP_SCHEMA, STEP_KINDS, NETWORK_PRESET_NAMES } from "./tools.mjs";
export { Lab, NETWORK_PRESETS, GAMEPAD_SHIM } from "./lab.mjs";
export { runScenario } from "./scenario.mjs";
export { exportTest } from "./export.mjs";
export { HOOK_JS } from "./hook.mjs";
export { renderShell } from "./shell.mjs";
export { SEEDED_DEVICES, DEVICE_GROUPS, GROUP_LABELS, USER_DEVICES_PATH, allDevices, resolveDevice, upsertUserDevice, deleteUserDevice, emulationFor, labOptionsFor, describeDevice, normalizeDevice } from "./devices.mjs";
export { HOOK_PATH, serveStatic, proxyRequest, proxyUpgrade, detectEntry, looksLikeWasmExport, applyIsolation } from "./server.mjs";
export { startMcpServer } from "./mcp.mjs";
export { GUIDE, EXAMPLES, guideText, topicList, findTopic } from "./guide.mjs";
