@echo off
echo Building YTFloat Helper...

:: Kill running instance first
taskkill /F /IM YTFloatHelper.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: Find csc.exe
setlocal enabledelayedexpansion
set CSC=
for %%p in (
  "%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  "%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) do if exist %%p if "!CSC!"=="" set CSC=%%p

if "!CSC!"=="" (
  echo ERROR: .NET Framework 4.x not found.
  pause & exit /b 1
)

echo Using: !CSC!
!CSC! /out:YTFloatHelper.exe /target:exe /platform:x64 /optimize+ ^
  NativeMessage.cs WindowFinder.cs WindowStyleManager.cs HotkeyListener.cs Program.cs

if %ERRORLEVEL%==0 (
  echo.
  echo Build successful: YTFloatHelper.exe
  echo Run install.bat if this is the first time.
) else (
  echo Build FAILED.
)
pause
