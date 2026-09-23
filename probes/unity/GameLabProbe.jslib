// GameLab probe — Unity WebGL side. Put this file in Assets/Plugins/WebGL/ next to GameLabProbe.cs.
// Bootstrap is shared with probes/godot/gamelab_probe.gd — keep in sync.
var GameLabProbeLib = {
  GameLab_Init: function () {
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
  },

  GameLab_Push: function (jsonPtr) {
    try { window.__game.__push(JSON.parse(UTF8ToString(jsonPtr))); } catch (e) { console.warn("GameLabProbe push failed", e); }
  },

  GameLab_Mark: function (namePtr) {
    if (window.__game) window.__game.mark(UTF8ToString(namePtr));
  },

  GameLab_Event: function (namePtr, dataJsonPtr) {
    var data = null;
    try { data = JSON.parse(UTF8ToString(dataJsonPtr)); } catch (e) {}
    if (window.__game) window.__game.event(UTF8ToString(namePtr), data);
  },

  // Returns "name\nargsJson" for the next queued command, or "" — Unity polls this each frame.
  GameLab_PopCommand: function () {
    var s = window.__game ? window.__game.__pop() : "";
    var size = lengthBytesUTF8(s) + 1;
    var buf = _malloc(size);
    stringToUTF8(s, buf, size);
    return buf;
  }
};

mergeInto(LibraryManager.library, GameLabProbeLib);
