using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

public static class NativeMessage
{
    public static string Read()
    {
        var stdin = Console.OpenStandardInput();
        var lenBuf = new byte[4];
        int read = 0;
        while (read < 4)
        {
            int n = stdin.Read(lenBuf, read, 4 - read);
            if (n <= 0) return null;
            read += n;
        }
        int len = BitConverter.ToInt32(lenBuf, 0);
        if (len <= 0 || len > 1048576) return null;

        var buf = new byte[len];
        int total = 0;
        while (total < len)
        {
            int n = stdin.Read(buf, total, len - total);
            if (n <= 0) return null;
            total += n;
        }
        return Encoding.UTF8.GetString(buf);
    }

    public static void Write(string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        var stdout = Console.OpenStandardOutput();
        stdout.Write(BitConverter.GetBytes(bytes.Length), 0, 4);
        stdout.Write(bytes, 0, bytes.Length);
        stdout.Flush();
    }

    public static string GetStr(string json, string key)
    {
        var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]+)\"");
        return m.Success ? m.Groups[1].Value : null;
    }

    public static int? GetInt(string json, string key)
    {
        var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(-?\\d+)");
        if (m.Success)
        {
            int v;
            if (int.TryParse(m.Groups[1].Value, out v)) return v;
        }
        return null;
    }
}
