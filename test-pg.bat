@echo off
set PGBIN=e:\KAYO\KAYO\apps\desktop\dist\win-unpacked\resources\runtime\postgres\bin
set PGDATA=C:\Users\DELL\AppData\Local\KAYO\data\pg2
set PATH=%PGBIN%;e:\KAYO\KAYO\apps\desktop\dist\win-unpacked\resources\runtime\postgres\lib;%PATH%
rmdir /s /q "%PGDATA%" 2>nul
mkdir "%PGDATA%"
echo === INITDB ===
"%PGBIN%\initdb.exe" -D "%PGDATA%" -U kayo -A trust --encoding=UTF8
echo === START ===
"%PGBIN%\pg_ctl.exe" start -D "%PGDATA%" -l "C:\Users\DELL\AppData\Local\KAYO\logs\pg2.log" -o "-p 5555 -h 127.0.0.1" -w
echo === TEST ===
"%PGBIN%\psql.exe" -h 127.0.0.1 -p 5555 -U kayo -d postgres -c "SELECT 'BUNDLED_PG_OK' as result;"
echo === STOP ===
"%PGBIN%\pg_ctl.exe" stop -D "%PGDATA%" -m fast
