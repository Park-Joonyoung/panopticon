@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
set "launch_exit=%errorlevel%"
if not "%launch_exit%"=="0" (
    echo.
    echo Panopticon could not start. See the error above.
    pause
)
exit /b %launch_exit%
