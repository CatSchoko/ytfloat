using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class WindowFinder
{
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc f, IntPtr p);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern int  GetWindowLong(IntPtr h, int n);
    [DllImport("user32.dll")] static extern int  GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int maxCount);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    const int GWL_EXSTYLE   = -20;
    const int WS_EX_TOPMOST = 0x00000008;

    static readonly HashSet<string> Browsers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "brave", "chrome", "chromium", "msedge" };

    // Zuverlässigste Zuordnung: eindeutiger Marker im Fenstertitel (via
    // document.title vom PiP-Fenster gesetzt). Unempfindlich gegen
    // DPI-Skalierung, Verschieben/Resizen des Fensters – im Gegensatz zu
    // FindByBounds, das dabei das falsche Fenster treffen kann.
    public static IntPtr FindByTitle(string marker)
    {
        if (string.IsNullOrEmpty(marker)) return IntPtr.Zero;
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hWnd, IntPtr param)
        {
            if (!IsWindowVisible(hWnd) || !IsBrowser(hWnd)) return true;
            int len = GetWindowTextLength(hWnd);
            if (len <= 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            if (sb.ToString().IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static IntPtr FindByBounds(int x, int y, int w, int h, int tol = 20)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hWnd, IntPtr param)
        {
            if (!IsWindowVisible(hWnd) || !IsBrowser(hWnd)) return true;
            RECT r;
            GetWindowRect(hWnd, out r);
            int rw = r.Right  - r.Left;
            int rh = r.Bottom - r.Top;
            if (Math.Abs(r.Left - x) <= tol &&
                Math.Abs(r.Top  - y) <= tol &&
                Math.Abs(rw     - w) <= tol &&
                Math.Abs(rh     - h) <= tol)
            {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static IntPtr FindSmallestTopmost()
    {
        IntPtr best = IntPtr.Zero;
        long bestArea = long.MaxValue;
        EnumWindows(delegate(IntPtr hWnd, IntPtr param)
        {
            if (!IsWindowVisible(hWnd) || !IsBrowser(hWnd)) return true;
            if ((GetWindowLong(hWnd, GWL_EXSTYLE) & WS_EX_TOPMOST) == 0) return true;
            RECT r;
            GetWindowRect(hWnd, out r);
            long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
            if (area > 0 && area < bestArea) { bestArea = area; best = hWnd; }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    static bool IsBrowser(IntPtr hWnd)
    {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        try
        {
            string name = Process.GetProcessById((int)pid).ProcessName;
            return Browsers.Contains(name);
        }
        catch { return false; }
    }
}
