using System;
using System.Runtime.InteropServices;
using System.Threading;

// Registriert Alt+P systemweit (RegisterHotKey mit hWnd=NULL bindet den
// Hotkey an die Message-Queue DIESES Threads statt an ein Fenster – so
// braucht es kein sichtbares Fenster). Funktioniert dadurch auch, wenn
// Chrome/Brave nicht im Vordergrund oder gar nicht fokussiert ist.
public static class HotkeyListener
{
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] static extern int  GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [StructLayout(LayoutKind.Sequential)]
    struct MSG
    {
        public IntPtr hwnd;
        public uint   message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint   time;
        public int    ptX;
        public int    ptY;
    }

    const uint MOD_ALT    = 0x0001;
    const uint VK_P       = 0x50;
    const uint WM_HOTKEY  = 0x0312;
    const int  HOTKEY_ID  = 0xA001;

    static Thread _thread;

    // Wird bei jedem Alt+P-Druck aufgerufen (auf dem Hotkey-Thread!).
    public static Action OnToggle;

    public static void Start()
    {
        if (_thread != null) return;
        _thread = new Thread(Run) { IsBackground = true };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    static void Run()
    {
        if (!RegisterHotKey(IntPtr.Zero, HOTKEY_ID, MOD_ALT, VK_P))
        {
            Program.Log("HotkeyListener: RegisterHotKey(Alt+P) fehlgeschlagen (evtl. von anderer App belegt)");
            return;
        }
        Program.Log("HotkeyListener: globaler Alt+P-Hotkey registriert");

        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) != 0)
        {
            if (msg.message == WM_HOTKEY && msg.wParam.ToInt32() == HOTKEY_ID)
            {
                try { var cb = OnToggle; if (cb != null) cb(); }
                catch (Exception ex) { Program.Log("Hotkey-Callback Fehler: " + ex); }
            }
        }
        UnregisterHotKey(IntPtr.Zero, HOTKEY_ID);
    }
}
