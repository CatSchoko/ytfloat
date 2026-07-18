using System;
using System.Runtime.InteropServices;

public static class WindowStyleManager
{
    [DllImport("user32.dll")] static extern int  GetWindowLong(IntPtr h, int n);
    [DllImport("user32.dll")] static extern int  SetWindowLong(IntPtr h, int n, int v);
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr z, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);

    const int  GWL_EXSTYLE       = -20;
    const int  WS_EX_LAYERED     = 0x00080000;
    const int  WS_EX_TRANSPARENT = 0x00000020;
    const uint LWA_ALPHA         = 0x00000002;
    const uint SWP_NOMOVE        = 0x0002;
    const uint SWP_NOSIZE        = 0x0001;
    const uint SWP_NOZORDER      = 0x0004;
    const uint SWP_FRAMECHANGED  = 0x0020;

    static IntPtr _hwnd          = IntPtr.Zero;
    static int    _originalStyle = 0;
    static bool   _ctOn          = false;
    static byte   _alpha         = 255;

    public static bool HasTarget { get { return _hwnd != IntPtr.Zero; } }

    // Ist das gegebene Handle noch ein gültiges, existierendes Fenster?
    // Wichtig, um nach Verschieben/Resizen/Neu-Öffnen nicht auf einem
    // toten Handle weiterzuarbeiten (Ursache des "Click-Through wirkt
    // nach mehrfachem Umschalten irgendwann nicht mehr"-Bugs).
    public static bool IsValid(IntPtr hwnd)
    {
        return hwnd != IntPtr.Zero && IsWindow(hwnd);
    }

    // Check if click-through is currently active on the window
    public static bool IsClickThrough(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        int style = GetWindowLong(hwnd, GWL_EXSTYLE);
        return (style & WS_EX_TRANSPARENT) != 0;
    }

    // Übernimmt ein (neues) Ziel-Handle. Nur beim ersten Mal bzw. wenn sich
    // das Handle wirklich geändert hat wird der Originalstil gesichert –
    // sonst würde ein zwischenzeitlich bereits modifizierter Stil als
    // "Original" gespeichert und beim Disable falsch wiederhergestellt.
    static void Track(IntPtr hwnd)
    {
        if (_hwnd == hwnd) return;
        _hwnd = hwnd;
        _originalStyle = GetWindowLong(hwnd, GWL_EXSTYLE) & ~WS_EX_TRANSPARENT & ~WS_EX_LAYERED;
        _ctOn  = false;
        _alpha = 255;
    }

    // Wendet den aktuellen kombinierten Zustand (Click-Through + Opacity)
    // konsistent auf das Fenster an.
    static void Apply(IntPtr hwnd)
    {
        int style = _originalStyle | WS_EX_LAYERED;
        if (_ctOn) style |= WS_EX_TRANSPARENT;
        SetWindowLong(hwnd, GWL_EXSTYLE, style);
        SetLayeredWindowAttributes(hwnd, 0, _alpha, LWA_ALPHA);
        SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
    }

    public static bool Enable(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        Track(hwnd);
        _ctOn = true;
        Apply(hwnd);
        return true;
    }

    public static bool Disable()
    {
        if (_hwnd == IntPtr.Zero || !IsWindow(_hwnd)) return false;
        _ctOn = false;
        Apply(_hwnd);
        return true;
    }

    public static bool SetOpacity(IntPtr hwnd, byte alpha)
    {
        if (hwnd == IntPtr.Zero) return false;
        Track(hwnd);
        _alpha = alpha;
        Apply(hwnd);
        return true;
    }
}
