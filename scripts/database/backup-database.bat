@echo off
setlocal enabledelayedexpansion

REM PowerShell as vezes deixa %~dp0 vazio; %~f0 sempre resolve o .bat
for %%I in ("%~f0") do set "DATABASE_SCRIPTS=%%~dpI"

echo ========================================
echo   Plumo - Database Backup
echo ========================================
echo.

pushd %DATABASE_SCRIPTS%..\..

set "SOURCE_ENV="
set "FOR_ONLINE="

:parse_backup_args
if "%~1"=="" goto :done_backup_args
if /i "%~1"=="--from" (
    set "SOURCE_ENV=%~2"
    shift & shift
    goto :parse_backup_args
)
if /i "%~1"=="--prod" set "SOURCE_ENV=prod" & shift & goto :parse_backup_args
if /i "%~1"=="prod" set "SOURCE_ENV=prod" & shift & goto :parse_backup_args
if /i "%~1"=="--dev" set "SOURCE_ENV=dev" & shift & goto :parse_backup_args
if /i "%~1"=="dev" set "SOURCE_ENV=dev" & shift & goto :parse_backup_args
if /i "%~1"=="--for-online" set "FOR_ONLINE=1" & shift & goto :parse_backup_args
echo [WARN] Argumento ignorado: %~1
shift
goto :parse_backup_args
:done_backup_args

if not defined SOURCE_ENV set "SOURCE_ENV=prod"

if /i "!SOURCE_ENV!"=="dev" (
    set CONTAINER_NAME=plumo-postgres-dev
    set DB_NAME=plumo_dev
    set DB_USER=plumo
    set DB_PASSWORD=plumo
    set ENVIRONMENT=dev
) else (
    set CONTAINER_NAME=plumo-postgres
    set DB_NAME=plumo
    set DB_USER=plumo
    set DB_PASSWORD=plumo
    set ENVIRONMENT=prod
)

if not exist "backups" (
    echo Creating backups directory...
    mkdir backups
    echo.
)

for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'"`) do set "TIMESTAMP=%%I"
if not defined TIMESTAMP (
    echo [ERROR] Failed to generate timestamp via PowerShell.
    pause
    exit /b 1
)

set BACKUP_FILE=backups\%DB_NAME%_%ENVIRONMENT%_%TIMESTAMP%

echo [INFO] Backup --from %SOURCE_ENV%: %DB_NAME% @ %CONTAINER_NAME%
echo [INFO] Arquivos: %BACKUP_FILE%.backup + .meta
echo.

docker ps | findstr %CONTAINER_NAME% >nul
if errorlevel 1 (
    echo [ERROR] Container %CONTAINER_NAME% is not running!
    pause
    exit /b 1
)

echo [1/3] Creating custom format backup...
docker exec -e PGPASSWORD=%DB_PASSWORD% %CONTAINER_NAME% pg_dump -U %DB_USER% -d %DB_NAME% -F c -f /tmp/backup.dump
if errorlevel 1 (
    echo [ERROR] Failed to create custom format backup!
    pause
    exit /b 1
)
docker cp %CONTAINER_NAME%:/tmp/backup.dump %BACKUP_FILE%.backup
docker exec %CONTAINER_NAME% rm /tmp/backup.dump
echo [SUCCESS] %BACKUP_FILE%.backup
echo.

echo [2/3] Creating SQL format backup...
docker exec -e PGPASSWORD=%DB_PASSWORD% %CONTAINER_NAME% pg_dump -U %DB_USER% -d %DB_NAME% -F p -f /tmp/backup.sql
if errorlevel 1 (
    echo [ERROR] Failed to create SQL format backup!
    pause
    exit /b 1
)
docker cp %CONTAINER_NAME%:/tmp/backup.sql %BACKUP_FILE%.sql
docker exec %CONTAINER_NAME% rm /tmp/backup.sql
echo [SUCCESS] %BACKUP_FILE%.sql
echo.

echo [3/3] Writing .meta (SOURCE_ENV, sem segredos)...
python "%DATABASE_SCRIPTS%backup_meta.py" write --base "%BACKUP_FILE%" --source %SOURCE_ENV% --db-name %DB_NAME%
if errorlevel 1 (
    echo [ERROR] backup_meta.py failed
    pause
    exit /b 1
)
echo.

echo ========================================
echo   Backup Completed Successfully!
echo ========================================
echo.
echo [TIP] Restore local: restore-database.bat "%BACKUP_FILE%.backup" --to dev --keys %SOURCE_ENV%
echo [TIP] Restore VPS:     git push backups^&meta, ship-online-env.ps1, restore-online.sh ...
if defined FOR_ONLINE (
    echo.
    echo [Online] Proximos passos:
    echo   git add backups ^&^& git commit -m "backup %SOURCE_ENV%" ^&^& git push
    echo   powershell -File scripts\database\ship-online-env.ps1 -Keys %SOURCE_ENV%
    echo   No VPS: git pull ^&^& ./scripts/database/restore-online.sh backups\...backup --to online --keys %SOURCE_ENV%
)
echo.
popd
pause