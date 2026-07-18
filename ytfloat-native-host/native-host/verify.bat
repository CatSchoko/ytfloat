@echo off
setlocal enabledelayedexpansion
echo ============================================
echo  YTFloat Helper - Diagnose
echo ============================================
echo.

set JSON_PATH=%~dp0com.ytfloat.helper.json

:: Check JSON file
if exist "!JSON_PATH!" (
  echo [OK] JSON manifest exists: !JSON_PATH!
) else (
  echo [!!] JSON manifest MISSING: !JSON_PATH!
  echo      Run install.bat first!
  pause & exit /b 1
)

:: Validate JSON and check paths
echo.
echo JSON Inhalt:
echo ─────────────────────────────────────────────
powershell -NoProfile -Command ^
  "try { $j = Get-Content '!JSON_PATH!' | ConvertFrom-Json; " ^
  "Write-Host '  name:    ' $j.name; " ^
  "Write-Host '  path:    ' $j.path; " ^
  "Write-Host '  origins: ' ($j.allowed_origins -join ', '); " ^
  "if (Test-Path $j.path) { Write-Host '  exe:     [OK] Gefunden' } " ^
  "else { Write-Host '  exe:     [!!] NICHT GEFUNDEN - falscher Pfad!' } " ^
  "} catch { Write-Host '  [!!] JSON ungültig: ' $_ }"

:: Check Registry - Brave
echo.
echo Registry:
echo ─────────────────────────────────────────────
reg query "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.ytfloat.helper" >nul 2>&1
if !ERRORLEVEL!==0 (
  echo [OK] Brave Registry-Eintrag vorhanden
  for /f "tokens=3" %%a in ('reg query "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.ytfloat.helper" /ve 2^>nul') do echo      Pfad: %%a
) else (
  echo [!!] Brave Registry-Eintrag FEHLT - install.bat ausführen!
)

reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytfloat.helper" >nul 2>&1
if !ERRORLEVEL!==0 (echo [OK] Chrome Registry-Eintrag vorhanden) else (echo [--] Chrome nicht installiert)

:: Check log
echo.
echo Letzter Log-Eintrag:
echo ─────────────────────────────────────────────
set LOG=%LOCALAPPDATA%\YTFloatHelper\log.txt
if exist "!LOG!" (
  powershell -NoProfile -Command "Get-Content '!LOG!' -Tail 10"
) else (
  echo (noch kein Log - Host wurde noch nicht gestartet)
)

echo.
pause
