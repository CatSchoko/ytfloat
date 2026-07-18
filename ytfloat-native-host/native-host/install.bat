@echo off
setlocal enabledelayedexpansion
echo ============================================
echo  YTFloat Helper - Installer
echo ============================================
echo.

if not exist "%~dp0YTFloatHelper.exe" (
  echo ERROR: YTFloatHelper.exe not found.
  echo Please run build.bat first.
  pause & exit /b 1
)

set EXE_PATH=%~dp0YTFloatHelper.exe
:: Remove trailing backslash issues - normalize path
for %%I in ("!EXE_PATH!") do set EXE_PATH=%%~fI

echo Step 1: Enter Extension ID
echo ─────────────────────────────────────────────
echo  1. Open Brave: brave://extensions
echo  2. Enable Developer Mode (top right)
echo  3. Find "YouTube Float" - copy the ID
echo     Example: abcdefghijklmnopabcdefghijklmnop
echo.
echo  TIP: Click the extension icon in toolbar
echo       and use "Extension-ID kopieren" button
echo.
set /p EXT_ID="Paste Extension ID: "
if "!EXT_ID!"=="" ( echo ERROR: No ID entered. & pause & exit /b 1 )

:: Strip spaces from ID
set EXT_ID=!EXT_ID: =!

set JSON_PATH=%~dp0com.ytfloat.helper.json

:: Use PowerShell to write JSON (avoids all batch echo encoding issues)
powershell -NoProfile -Command ^
  "$exe = '!EXE_PATH!'.Replace('\','\\'); " ^
  "$json = '{\"name\":\"com.ytfloat.helper\",\"description\":\"YTFloat Helper\",\"path\":\"' + $exe + '\",\"type\":\"stdio\",\"allowed_origins\":[\"chrome-extension://!EXT_ID!/\"]}'; " ^
  "[System.IO.File]::WriteAllText('!JSON_PATH!', $json, [System.Text.Encoding]::UTF8)"

if not exist "!JSON_PATH!" (
  echo ERROR: Failed to write JSON manifest.
  pause & exit /b 1
)

echo [OK] Wrote: !JSON_PATH!
echo.
echo Step 2: Register Registry Keys
echo ─────────────────────────────────────────────

:: Brave
reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.ytfloat.helper" /ve /t REG_SZ /d "!JSON_PATH!" /f >nul 2>&1
if !ERRORLEVEL!==0 (echo [OK] Brave registered.) else (echo [!!] Brave reg failed - try as Admin)

:: Chrome
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytfloat.helper" /ve /t REG_SZ /d "!JSON_PATH!" /f >nul 2>&1
if !ERRORLEVEL!==0 (echo [OK] Chrome registered.) else (echo [--] Chrome: skipped.)

:: Chromium
reg add "HKCU\Software\Chromium\NativeMessagingHosts\com.ytfloat.helper" /ve /t REG_SZ /d "!JSON_PATH!" /f >nul 2>&1

echo.
echo Step 3: Verify
echo ─────────────────────────────────────────────
powershell -NoProfile -Command ^
  "try { $j = Get-Content '!JSON_PATH!' | ConvertFrom-Json; " ^
  "Write-Host '[OK] JSON valid'; " ^
  "Write-Host '  name:   ' $j.name; " ^
  "Write-Host '  path:   ' $j.path; " ^
  "Write-Host '  origin: ' $j.allowed_origins[0]; " ^
  "if (Test-Path $j.path) { Write-Host '[OK] EXE exists' } else { Write-Host '[!!] EXE NOT FOUND at: ' $j.path } " ^
  "} catch { Write-Host '[!!] JSON parse error: ' $_ }"

echo.
echo ============================================
echo  Done! Completely restart Brave/Chrome now.
echo  Log: %%LOCALAPPDATA%%\YTFloatHelper\log.txt
echo ============================================
pause
