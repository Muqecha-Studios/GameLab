// GameLab probe for Unity WebGL builds.
//
// Exposes game state, engine metrics (ProfilerRecorder counters), marks and events to
// gamelab — or any harness — through `window.__game`, and receives test commands.
// Compiles everywhere; only does work in WebGL players (no-op in the Editor and on other platforms).
//
// Setup:  copy GameLabProbe.cs and GameLabProbe.jslib into Assets/Plugins/WebGL/.
//         The probe creates itself at startup; no scene changes needed.
//
// Usage from game code:
//   GameLabProbe.SetState("phase", "racing");                     // merged; tests read it via state()
//   GameLabProbe.StateProvider = () => new() { ["speed"] = car.speed, ["lap"] = lap };
//   GameLabProbe.MetricsProvider = () => new() { ["entities"] = Enemy.Count };
//   GameLabProbe.Mark("level_loaded");                              // performance.mark → load timeline
//   GameLabProbe.Event("lap_completed", new() { ["lap"] = 2, ["time"] = 43.2f });
//   GameLabProbe.CommandReceived += (name, argsJson) => {           // let tests skip the menu
//       if (name == "start_race") StartRace(JsonUtility.FromJson<RaceArgs>(argsJson)); };
//
// Notes:
// - Render counters (Draw Calls, SetPass, Batches, Triangles) and "Main Thread" time are only
//   reported in Development Builds; memory counters work in release too. Missing ones are omitted.
// - For readable function names in gamelab's profiler, build with Development Build or
//   Player Settings → Publishing → "Debug Symbols: Embedded".
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using Unity.Profiling;
using UnityEngine;
using UnityEngine.SceneManagement;

public class GameLabProbe : MonoBehaviour
{
    public static GameLabProbe Instance { get; private set; }

    /// Fired for each `window.__game.command(name, args)`; args arrives as JSON text (or "null").
    public static event Action<string, string> CommandReceived;
    /// Optional: live values merged into state() on every push.
    public static Func<Dictionary<string, object>> StateProvider;
    /// Optional: extra numbers merged into metrics() on every push.
    public static Func<Dictionary<string, object>> MetricsProvider;

    public float pushIntervalSec = 0.25f;

    static readonly Dictionary<string, object> state = new Dictionary<string, object>();
    float accum;
    float frameMsSmoothed = 16.7f;

    ProfilerRecorder mainThread, gcAlloc, drawCalls, setPass, batches, triangles, totalUsed, gcReserved;

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] static extern void GameLab_Init();
    [DllImport("__Internal")] static extern void GameLab_Push(string json);
    [DllImport("__Internal")] static extern void GameLab_Mark(string name);
    [DllImport("__Internal")] static extern void GameLab_Event(string name, string dataJson);
    [DllImport("__Internal")] static extern string GameLab_PopCommand();
    const bool Enabled = true;
#else
    static void GameLab_Init() { }
    static void GameLab_Push(string json) { }
    static void GameLab_Mark(string name) { }
    static void GameLab_Event(string name, string dataJson) { }
    static string GameLab_PopCommand() => "";
    const bool Enabled = false;
#endif

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void AutoCreate()
    {
        if (!Enabled || Instance != null) return;
        var go = new GameObject("GameLabProbe");
        go.AddComponent<GameLabProbe>();
    }

    void Awake()
    {
        if (Instance != null && Instance != this) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        if (!Enabled) return;
        GameLab_Init();
        mainThread = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "Main Thread", 15);
        gcAlloc = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Allocated In Frame");
        gcReserved = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Reserved Memory");
        totalUsed = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "Total Used Memory");
        drawCalls = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Draw Calls Count");
        setPass = ProfilerRecorder.StartNew(ProfilerCategory.Render, "SetPass Calls Count");
        batches = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Batches Count");
        triangles = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Triangles Count");
        Push();
    }

    void OnDestroy()
    {
        mainThread.Dispose(); gcAlloc.Dispose(); gcReserved.Dispose(); totalUsed.Dispose();
        drawCalls.Dispose(); setPass.Dispose(); batches.Dispose(); triangles.Dispose();
    }

    void Update()
    {
        if (!Enabled) return;
        frameMsSmoothed = Mathf.Lerp(frameMsSmoothed, Time.unscaledDeltaTime * 1000f, 0.1f);
        for (int i = 0; i < 8; i++)
        {
            var cmd = GameLab_PopCommand();
            if (string.IsNullOrEmpty(cmd)) break;
            int nl = cmd.IndexOf('\n');
            var name = nl < 0 ? cmd : cmd.Substring(0, nl);
            var args = nl < 0 ? "null" : cmd.Substring(nl + 1);
            try { CommandReceived?.Invoke(name, args); }
            catch (Exception e) { Debug.LogException(e); }
        }
        accum += Time.unscaledDeltaTime;
        if (accum >= pushIntervalSec) { accum = 0f; Push(); }
    }

    // ---- public API --------------------------------------------------------

    public static void SetState(string key, object value)
    {
        state[key] = value;
        if (Instance != null && Enabled) Instance.Push();
    }

    public static void SetState(IDictionary<string, object> patch)
    {
        foreach (var kv in patch) state[kv.Key] = kv.Value;
        if (Instance != null && Enabled) Instance.Push();
    }

    public static void ResetState() { state.Clear(); if (Instance != null && Enabled) Instance.Push(); }

    public static void Mark(string name) { if (Enabled) GameLab_Mark(name); }

    public static void Event(string name, object data = null) { if (Enabled) GameLab_Event(name, Json(data)); }

    // ---- snapshot ----------------------------------------------------------

    void Push()
    {
        var sb = new StringBuilder(512);
        sb.Append("{\"engine\":\"unity\",\"version\":").Append(Json(Application.unityVersion));
        sb.Append(",\"state\":").Append(Json(CollectState()));
        sb.Append(",\"metrics\":").Append(Json(CollectMetrics())).Append('}');
        GameLab_Push(sb.ToString());
    }

    Dictionary<string, object> CollectState()
    {
        var s = new Dictionary<string, object>
        {
            ["scene"] = SceneManager.GetActiveScene().name,
            ["timeScale"] = Time.timeScale,
            ["targetFrameRate"] = Application.targetFrameRate,
        };
        foreach (var kv in state) s[kv.Key] = kv.Value;
        if (StateProvider != null) { try { Merge(s, StateProvider()); } catch (Exception e) { Debug.LogException(e); } }
        return s;
    }

    Dictionary<string, object> CollectMetrics()
    {
        var m = new Dictionary<string, object>
        {
            ["frameMs"] = Math.Round(frameMsSmoothed, 2),
            ["fps"] = Math.Round(1000f / Mathf.Max(0.01f, frameMsSmoothed), 1),
            ["monoHeapMB"] = Math.Round(GC.GetTotalMemory(false) / 1048576.0, 2),
            ["allocatedMB"] = Math.Round(UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong() / 1048576.0, 2),
            ["reservedMB"] = Math.Round(UnityEngine.Profiling.Profiler.GetTotalReservedMemoryLong() / 1048576.0, 2),
        };
        if (mainThread.Valid && mainThread.Count > 0) m["processMs"] = Math.Round(Average(mainThread) / 1e6, 2);
        if (gcAlloc.Valid) m["gcAllocKB"] = Math.Round(gcAlloc.LastValue / 1024.0, 2);
        if (gcReserved.Valid) m["gcReservedMB"] = Math.Round(gcReserved.LastValue / 1048576.0, 2);
        if (totalUsed.Valid) m["totalUsedMB"] = Math.Round(totalUsed.LastValue / 1048576.0, 2);
        if (drawCalls.Valid) m["drawCalls"] = drawCalls.LastValue;
        if (setPass.Valid) m["setPassCalls"] = setPass.LastValue;
        if (batches.Valid) m["batches"] = batches.LastValue;
        if (triangles.Valid) m["triangles"] = triangles.LastValue;
        if (MetricsProvider != null) { try { Merge(m, MetricsProvider()); } catch (Exception e) { Debug.LogException(e); } }
        return m;
    }

    static double Average(ProfilerRecorder r)
    {
        int n = r.Count; if (n == 0) return 0;
        double sum = 0;
        for (int i = 0; i < n; i++) sum += r.GetSample(i).Value;
        return sum / n;
    }

    static void Merge(Dictionary<string, object> into, Dictionary<string, object> extra)
    {
        if (extra == null) return;
        foreach (var kv in extra) into[kv.Key] = kv.Value;
    }

    // ---- minimal JSON writer (JsonUtility can't serialise dictionaries) ----

    public static string Json(object v)
    {
        var sb = new StringBuilder();
        Write(sb, v, 0);
        return sb.ToString();
    }

    static void Write(StringBuilder sb, object v, int depth)
    {
        if (v == null || depth > 8) { sb.Append("null"); return; }
        switch (v)
        {
            case string s: WriteString(sb, s); return;
            case bool b: sb.Append(b ? "true" : "false"); return;
            case float f: WriteNumber(sb, f); return;
            case double d: WriteNumber(sb, d); return;
            case int or long or short or byte or uint or ulong or ushort or sbyte or decimal:
                sb.Append(Convert.ToString(v, CultureInfo.InvariantCulture)); return;
            case Enum e: WriteString(sb, e.ToString()); return;
            case Vector2 v2: sb.Append("{\"x\":").Append(N(v2.x)).Append(",\"y\":").Append(N(v2.y)).Append('}'); return;
            case Vector3 v3: sb.Append("{\"x\":").Append(N(v3.x)).Append(",\"y\":").Append(N(v3.y)).Append(",\"z\":").Append(N(v3.z)).Append('}'); return;
            case Vector2Int v2i: sb.Append("{\"x\":").Append(v2i.x).Append(",\"y\":").Append(v2i.y).Append('}'); return;
            case Vector3Int v3i: sb.Append("{\"x\":").Append(v3i.x).Append(",\"y\":").Append(v3i.y).Append(",\"z\":").Append(v3i.z).Append('}'); return;
            case IDictionary dict:
                sb.Append('{'); bool first = true;
                foreach (DictionaryEntry kv in dict)
                {
                    if (!first) sb.Append(','); first = false;
                    WriteString(sb, kv.Key.ToString()); sb.Append(':'); Write(sb, kv.Value, depth + 1);
                }
                sb.Append('}'); return;
            case IEnumerable list:
                sb.Append('['); bool f1 = true;
                foreach (var item in list) { if (!f1) sb.Append(','); f1 = false; Write(sb, item, depth + 1); }
                sb.Append(']'); return;
            default: WriteString(sb, v.ToString()); return;
        }
    }

    static string N(double d) => double.IsFinite(d) ? d.ToString("R", CultureInfo.InvariantCulture) : "null";
    static void WriteNumber(StringBuilder sb, double d) => sb.Append(N(d));

    static void WriteString(StringBuilder sb, string s)
    {
        sb.Append('"');
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
    }
}
