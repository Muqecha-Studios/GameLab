## GameLab probe for Godot 4 Web exports.
##
## Exposes game state, engine metrics (Performance monitors), marks and events to
## gamelab — or any harness — through `window.__game`, and receives test commands.
## No-op on non-Web platforms, so it is safe to leave in the project.
##
## Setup:  Project Settings → Globals → Autoload → add this script as "GameLabProbe".
##
## Usage from game code:
##   GameLabProbe.set_state({"phase": "racing", "lap": 2})        # merged; tests read it via state()
##   GameLabProbe.state_provider = func(): return {"speed": car.speed, "pos": car.global_position}
##   GameLabProbe.metrics_provider = func(): return {"entities": get_tree().get_node_count_in_group("cars")}
##   GameLabProbe.mark("race_started")                              # performance.mark → load timeline
##   GameLabProbe.event("lap_completed", {"lap": 2, "time": 43.2})  # gameplay event → Perf tab / get_game_state
##   GameLabProbe.command_received.connect(func(name, args):        # let tests skip the menu
##       if name == "start_race": start_race(args.get("track", "default")))
##
## Debug exports keep the wasm name section, so gamelab's profiler shows real C++ function
## names instead of wasm-function[N]. Use a debug export while profiling.
extends Node

signal command_received(name: String, args: Variant)

## How often the snapshot is pushed to JS (seconds). set_state() pushes immediately.
@export var push_interval_sec: float = 0.25

## Optional Callable returning a Dictionary merged into state() on every push (live values).
var state_provider: Callable
## Optional Callable returning a Dictionary merged into metrics() on every push.
var metrics_provider: Callable

var _state: Dictionary = {}
var _enabled: bool = false
var _accum: float = 0.0
var _cmd_cb: JavaScriptObject
var _window: JavaScriptObject

# Shared with probes/unity/GameLabProbe.jslib — keep in sync.
const _BOOTSTRAP_JS := r"""
(function () {
  if (window.__game && window.__game.__gamelabProbe) return;
  var snap = { state: {}, metrics: {} }, queue = [];
  var g = window.__game = {
    __gamelabProbe: 1, engine: null, version: null,
    state: function () { return snap.state; },
    metrics: function () { return snap.metrics; },
    command: function (name, args) {
      var a = args == null ? null : args;
      if (g.__onCommand) { g.__onCommand(String(name), JSON.stringify(a)); return { accepted: true }; }
      queue.push({ name: String(name), args: a }); return { queued: true };
    },
    __push: function (d) { if (d.state) snap.state = d.state; if (d.metrics) snap.metrics = d.metrics; if (d.engine) g.engine = d.engine; if (d.version) g.version = d.version; },
    __drain: function () { var q = queue; queue = []; return q; },
    __pop: function () { var c = queue.shift(); return c ? c.name + "\n" + JSON.stringify(c.args) : ""; },
    __onCommand: null,
    mark: function (n) { try { performance.mark(String(n)); } catch (e) {} },
    event: function (n, data) { try { window.dispatchEvent(new CustomEvent("gamelab", { detail: { type: "event", name: String(n), data: data == null ? null : data, t: performance.now() } })); } catch (e) {} }
  };
})();
"""


func _ready() -> void:
	_enabled = OS.has_feature("web")
	if not _enabled:
		return
	JavaScriptBridge.eval(_BOOTSTRAP_JS, true)
	_window = JavaScriptBridge.get_interface("window")
	_cmd_cb = JavaScriptBridge.create_callback(_on_js_command)
	var game: JavaScriptObject = _window.__game
	game.__onCommand = _cmd_cb
	# Commands issued before the autoload was ready were queued in JS; replay them.
	var queued = JSON.parse_string(str(JavaScriptBridge.eval("JSON.stringify(window.__game.__drain())", true)))
	if queued is Array:
		for c in queued:
			_on_js_command([c.get("name", ""), JSON.stringify(c.get("args"))])
	_push()


func _process(delta: float) -> void:
	if not _enabled:
		return
	_accum += delta
	if _accum >= push_interval_sec:
		_accum = 0.0
		_push()


## Merge `patch` into the state dictionary and push it right away.
func set_state(patch: Dictionary) -> void:
	_state.merge(patch, true)
	if _enabled:
		_push()


## Replace the whole state dictionary.
func reset_state(new_state: Dictionary = {}) -> void:
	_state = new_state.duplicate()
	if _enabled:
		_push()


## Record a User Timing mark (shows in the load timeline / Perf tab).
func mark(name: String) -> void:
	if _enabled:
		JavaScriptBridge.eval("window.__game.mark(%s)" % JSON.stringify(name), true)


## Emit a gameplay event (shows in the Perf tab and get_game_state → events).
func event(name: String, data: Variant = null) -> void:
	if _enabled:
		JavaScriptBridge.eval("window.__game.event(%s, %s)" % [JSON.stringify(name), JSON.stringify(data)], true)


func snapshot() -> Dictionary:
	return {"engine": "godot", "version": Engine.get_version_info().string, "state": _collect_state(), "metrics": _collect_metrics()}


func _push() -> void:
	JavaScriptBridge.eval("window.__game.__push(%s)" % JSON.stringify(snapshot()), true)


func _collect_state() -> Dictionary:
	var s: Dictionary = {}
	var tree := get_tree()
	if tree and tree.current_scene:
		s["scene"] = String(tree.current_scene.name)
		s["scene_path"] = tree.current_scene.scene_file_path
	if tree:
		s["paused"] = tree.paused
	s["time_scale"] = Engine.time_scale
	s.merge(_state, true)
	if state_provider.is_valid():
		var extra = state_provider.call()
		if extra is Dictionary:
			s.merge(extra, true)
	return s


func _collect_metrics() -> Dictionary:
	var P := Performance
	var m: Dictionary = {
		"fps": P.get_monitor(P.TIME_FPS),
		"processMs": _ms(P.get_monitor(P.TIME_PROCESS)),
		"physicsMs": _ms(P.get_monitor(P.TIME_PHYSICS_PROCESS)),
		"navigationMs": _ms(P.get_monitor(P.TIME_NAVIGATION_PROCESS)),
		"nodes": int(P.get_monitor(P.OBJECT_NODE_COUNT)),
		"orphanNodes": int(P.get_monitor(P.OBJECT_ORPHAN_NODE_COUNT)),
		"objects": int(P.get_monitor(P.OBJECT_COUNT)),
		"resources": int(P.get_monitor(P.OBJECT_RESOURCE_COUNT)),
		"drawCalls": int(P.get_monitor(P.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		"renderObjects": int(P.get_monitor(P.RENDER_TOTAL_OBJECTS_IN_FRAME)),
		"primitives": int(P.get_monitor(P.RENDER_TOTAL_PRIMITIVES_IN_FRAME)),
		"videoMemMB": _mb(P.get_monitor(P.RENDER_VIDEO_MEM_USED)),
		"textureMB": _mb(P.get_monitor(P.RENDER_TEXTURE_MEM_USED)),
		"bufferMemMB": _mb(P.get_monitor(P.RENDER_BUFFER_MEM_USED)),
		"staticMemMB": _mb(P.get_monitor(P.MEMORY_STATIC)),
		"physics3dActive": int(P.get_monitor(P.PHYSICS_3D_ACTIVE_OBJECTS)),
		"physics3dPairs": int(P.get_monitor(P.PHYSICS_3D_COLLISION_PAIRS)),
		"physics2dActive": int(P.get_monitor(P.PHYSICS_2D_ACTIVE_OBJECTS)),
		"physics2dPairs": int(P.get_monitor(P.PHYSICS_2D_COLLISION_PAIRS)),
		"audioLatencyMs": _ms(P.get_monitor(P.AUDIO_OUTPUT_LATENCY)),
	}
	var custom: Dictionary = {}
	for id in P.get_custom_monitor_names():
		custom[String(id)] = P.get_custom_monitor(id)
	if not custom.is_empty():
		m["custom"] = custom
	if metrics_provider.is_valid():
		var extra = metrics_provider.call()
		if extra is Dictionary:
			m.merge(extra, true)
	return m


func _on_js_command(args: Array) -> void:
	var name := String(args[0]) if args.size() > 0 else ""
	var parsed: Variant = null
	if args.size() > 1 and args[1] != null and String(args[1]) != "null":
		parsed = JSON.parse_string(String(args[1]))
	command_received.emit(name, parsed)


static func _ms(sec: float) -> float:
	return snappedf(sec * 1000.0, 0.01)


static func _mb(bytes: float) -> float:
	return snappedf(bytes / 1048576.0, 0.01)
