# YTFloat

A floating YouTube window for Windows that breaks free of the browser tab:

- **Always on top** – the video stays visible no matter which window is active
- **Click-through** – clicks pass through the window to whatever's behind it (Alt+P, also works outside the browser)
- **Opacity slider** – make the window as transparent as you like
- **Play/pause, seek ±5s, volume** built right into the floating window

Made of two parts: the Chrome extension (`yt-float-ext-fixed/`) and a small native Windows helper (`ytfloat-native-host/`) that talks to the extension via Native Messaging and controls the OS-level window properties.

## Installation
1. Load the extension in `chrome://extensions` (Developer Mode) as "Load unpacked"
2. Run `ytfloat-native-host/native-host/build.bat` (requires .NET Framework 4.x)
3. Run `install.bat` and paste in your extension ID
4. Restart the browser
