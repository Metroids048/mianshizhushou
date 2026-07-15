@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-experience.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not %EXIT_CODE%==0 (
  echo [ERROR] Startup failed. Check errors above and logs\dev.log / logs\server.log
  pause
  exit /b %EXIT_CODE%
)
echo.
echo ========================================
echo   Startup OK
echo ========================================
echo.
echo Frontend: http://127.0.0.1:5173/
echo Backend:  http://127.0.0.1:8787/api/health
echo Logs:     logs\dev.log  and  logs\server.log
echo.
echo Browser should open automatically. If it does not, open the frontend URL above.
echo This window stays open until you press a key.
echo Closing this window does NOT stop frontend/backend.
pause
