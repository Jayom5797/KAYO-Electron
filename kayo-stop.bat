@echo off
title KAYO Stop
echo.
echo  Stopping KAYO services...
echo.

:: Kill KAYO processes
taskkill /FI "WINDOWTITLE eq KAYO Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq KAYO Frontend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq KAYO Desktop*" /F >nul 2>&1

:: Also kill by process name if needed
taskkill /IM "electron.exe" /F >nul 2>&1

echo  [OK] All KAYO services stopped.
echo.
echo  Docker infrastructure is still running.
echo  To stop Docker: docker compose -f docker-compose.e2e.yml down
echo.
pause
