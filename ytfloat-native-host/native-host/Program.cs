using System;
using System.IO;
using System.Text;
using System.Threading;

class Program
{
    static IntPtr _pipHwnd    = IntPtr.Zero;
    static bool   _ctActive   = false;
    static Timer  _monitor    = null;
    static readonly object _lock      = new object();
    static readonly object _writeLock = new object(); // serialisiert stdout (Antworten + unsolicited)

    static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "YTFloatHelper", "log.txt");

    static void Main()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
        Log("=== YTFloat Helper started ===");
        Console.InputEncoding  = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        HotkeyListener.OnToggle = ToggleClickThroughFromHotkey;
        HotkeyListener.Start();

        try
        {
            while (true)
            {
                string msg = NativeMessage.Read();
                if (msg == null) { Log("stdin closed"); break; }
                Log("IN  " + msg);
                string resp = Dispatch(msg);
                Log("OUT " + resp);
                lock (_writeLock) { NativeMessage.Write(resp); }
            }
        }
        catch (Exception ex) { Log("Fatal: " + ex.ToString()); }

        StopMonitor();
        if (_ctActive) WindowStyleManager.Disable();
        Log("=== YTFloat Helper stopped ===");
    }

    // Findet/bestätigt das Ziel-Fenster in dieser Prioritätsreihenfolge:
    //   1) bereits bekanntes Handle, falls noch gültig (schnellster Pfad)
    //   2) eindeutiger Titel-Marker (zuverlässig, unabhängig von DPI/Position)
    //   3) Fenster-Bounds mit Toleranz (Fallback)
    //   4) kleinstes topmost Browser-Fenster (letzter Ausweg)
    // Der alte Code hat bei JEDEM Aufruf nur über Bounds+Toleranz gesucht;
    // bei DPI-Skalierung oder nach Verschieben/Resizen driftete das schnell
    // aus der Toleranz und traf dann zufällig ein anderes Browser-Fenster –
    // das war die Ursache dafür, dass Click-Through nach mehrfachem
    // Umschalten "die Wirkung verliert".
    static IntPtr ResolveHwnd(string json)
    {
        if (_pipHwnd != IntPtr.Zero && WindowStyleManager.IsValid(_pipHwnd)) return _pipHwnd;

        string title = NativeMessage.GetStr(json, "title");
        if (!string.IsNullOrEmpty(title))
        {
            var byTitle = WindowFinder.FindByTitle(title);
            if (byTitle != IntPtr.Zero) { _pipHwnd = byTitle; return _pipHwnd; }
        }

        int? x = NativeMessage.GetInt(json, "x"), y = NativeMessage.GetInt(json, "y");
        int? w = NativeMessage.GetInt(json, "w"), h = NativeMessage.GetInt(json, "h");
        if (x != null && y != null && w != null && h != null)
        {
            var byBounds = WindowFinder.FindByBounds(x.Value, y.Value, w.Value, h.Value);
            if (byBounds != IntPtr.Zero) { _pipHwnd = byBounds; return _pipHwnd; }
        }

        var fallback = WindowFinder.FindSmallestTopmost();
        if (fallback != IntPtr.Zero) _pipHwnd = fallback;
        return _pipHwnd;
    }

    static string Dispatch(string json)
    {
        int?   reqId   = NativeMessage.GetInt(json, "_id");
        string idField = reqId.HasValue ? (",\"_id\":" + reqId.Value) : "";
        string type    = NativeMessage.GetStr(json, "type");
        if (type == null)
            return "{\"ok\":false,\"error\":\"missing_type\"" + idField + "}";

        if (type == "pip_opened")
        {
            _pipHwnd = IntPtr.Zero; // neue PiP-Session: alten Handle-Cache verwerfen
            IntPtr hwnd = IntPtr.Zero;
            for (int i = 0; i < 10 && hwnd == IntPtr.Zero; i++)
            {
                hwnd = ResolveHwnd(json);
                if (hwnd == IntPtr.Zero) Thread.Sleep(200);
            }
            Log("PiP HWND = " + hwnd.ToInt64());
            return hwnd != IntPtr.Zero
                ? "{\"ok\":true,\"action\":\"pip_opened\",\"hwnd\":" + hwnd.ToInt64() + idField + "}"
                : "{\"ok\":false,\"error\":\"window_not_found\"" + idField + "}";
        }

        if (type == "enable_click_through")
        {
            IntPtr hwnd = ResolveHwnd(json);
            if (hwnd == IntPtr.Zero)
                return "{\"ok\":false,\"error\":\"window_not_found\"" + idField + "}";

            lock (_lock)
            {
                bool ok = WindowStyleManager.Enable(hwnd);
                _ctActive = ok;
                if (ok) StartMonitor();
            }
            return "{\"ok\":true,\"action\":\"enable_click_through\"" + idField + "}";
        }

        if (type == "disable_click_through")
        {
            StopMonitor();
            lock (_lock) { _ctActive = false; WindowStyleManager.Disable(); }
            return "{\"ok\":true,\"action\":\"disable_click_through\"" + idField + "}";
        }

        if (type == "set_opacity")
        {
            IntPtr hwnd = ResolveHwnd(json);
            if (hwnd == IntPtr.Zero)
                return "{\"ok\":false,\"error\":\"window_not_found\"" + idField + "}";

            int? alphaVal = NativeMessage.GetInt(json, "alpha");
            byte alpha = (byte)Math.Max(0, Math.Min(255, alphaVal ?? 255));
            lock (_lock) { WindowStyleManager.SetOpacity(hwnd, alpha); }
            return "{\"ok\":true,\"action\":\"set_opacity\"" + idField + "}";
        }

        if (type == "get_status")
            return "{\"ok\":true,\"click_through\":" + (_ctActive ? "true" : "false")
                + ",\"hwnd\":" + _pipHwnd.ToInt64() + idField + "}";

        return "{\"ok\":false,\"error\":\"unknown_type\"" + idField + "}";
    }

    // Wird vom globalen Alt+P-Hotkey aufgerufen (Program läuft dann evtl.
    // parallel zu einer laufenden Dispatch()-Anfrage – daher _lock).
    static void ToggleClickThroughFromHotkey()
    {
        bool newState;
        lock (_lock)
        {
            if (_pipHwnd == IntPtr.Zero || !WindowStyleManager.IsValid(_pipHwnd))
            {
                Log("Globaler Hotkey: kein bekanntes PiP-Fenster, ignoriere");
                return;
            }
            _ctActive = !_ctActive;
            newState = _ctActive;
            if (_ctActive) { WindowStyleManager.Enable(_pipHwnd); StartMonitor(); }
            else { StopMonitor(); WindowStyleManager.Disable(); }
        }
        Log("Globaler Hotkey Alt+P -> click_through=" + newState);
        // Unaufgeforderte Nachricht an die Extension, damit die UI (Button,
        // Leisten-Sichtbarkeit) synchron bleibt, obwohl der Toggle nicht
        // von der Extension selbst ausgelöst wurde.
        lock (_writeLock)
        {
            NativeMessage.Write("{\"type\":\"ct_toggled\",\"active\":" + (newState ? "true" : "false") + "}");
        }
    }

    // ── Native watchdog: checks every 800ms if WS_EX_TRANSPARENT is still set ──
    static void StartMonitor()
    {
        StopMonitor();
        _monitor = new Timer(_ =>
        {
            lock (_lock)
            {
                if (!_ctActive || _pipHwnd == IntPtr.Zero) return;
                if (!WindowStyleManager.IsValid(_pipHwnd))
                {
                    Log("Watchdog: Fenster nicht mehr gültig – gebe Ziel auf");
                    _ctActive = false;
                    return;
                }
                if (!WindowStyleManager.IsClickThrough(_pipHwnd))
                {
                    Log("Watchdog: style was reset – re-applying click-through");
                    WindowStyleManager.Enable(_pipHwnd);
                }
            }
        }, null, 800, 800);
    }

    static void StopMonitor()
    {
        if (_monitor != null) { _monitor.Dispose(); _monitor = null; }
    }

    public static void Log(string msg)
    {
        try { File.AppendAllText(LogPath, "[" + DateTime.Now.ToString("HH:mm:ss.fff") + "] " + msg + "\n"); }
        catch { }
    }
}
