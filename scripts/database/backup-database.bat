@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   Plumo - Database Backup
echo ========================================
echo.

REM Navegar para a raiz do projeto
pushd %~dp0..\..

REM Verificar parâmetros --dev ou --prod
set "TARGET_ENV="
if /i "%~1"=="--dev" set "TARGET_ENV=dev"
if /i "%~1"=="--prod" set "TARGET_ENV=prod"
if /i "%~1"=="dev" set "TARGET_ENV=dev"
if /i "%~1"=="prod" set "TARGET_ENV=prod"

REM Se foi especificado um ambiente, usar configurações fixas
if defined TARGET_ENV (
    if /i "!TARGET_ENV!"=="dev" (
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
) else (
    REM Carregar variáveis do .env se existir
    if exist ".env" (
        for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
            REM Ignorar linhas de comentário
            set "line=%%a"
            if not "!line:~0,1!"=="#" (
                set "%%a=%%b"
            )
        )
    )

    REM Configurações do banco (usa .env ou valores padrão)
    if not defined CONTAINER_NAME set CONTAINER_NAME=plumo-postgres
    if not defined DB_NAME set DB_NAME=plumo
    if not defined DB_USER set DB_USER=plumo
    if not defined DB_PASSWORD set DB_PASSWORD=plumo
    if not defined ENVIRONMENT set ENVIRONMENT=prod
)

REM Criar pasta de backups se não existir
if not exist "backups" (
    echo Creating backups directory...
    mkdir backups
    echo.
)

REM Gerar timestamp para o nome do arquivo
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set TIMESTAMP=%datetime:~0,4%-%datetime:~4,2%-%datetime:~6,2%_%datetime:~8,2%-%datetime:~10,2%-%datetime:~12,2%

REM Nome do arquivo inclui o ambiente
set BACKUP_FILE=backups\%DB_NAME%_%ENVIRONMENT%_%TIMESTAMP%

echo [INFO] Environment: %ENVIRONMENT%
echo [INFO] Container: %CONTAINER_NAME%
echo [INFO] Database: %DB_NAME%
echo [INFO] Backup file: %BACKUP_FILE%
echo.

REM Verificar se o container está rodando
docker ps | findstr %CONTAINER_NAME% >nul
if errorlevel 1 (
    echo [ERROR] Container %CONTAINER_NAME% is not running!
    echo [INFO] Please start the database first with: dkup or start-database.bat
    echo.
    pause
    exit /b 1
)

echo [1/2] Creating custom format backup (compressed, recommended for restore)...
docker exec -e PGPASSWORD=%DB_PASSWORD% %CONTAINER_NAME% pg_dump -U %DB_USER% -d %DB_NAME% -F c -f /tmp/backup.dump
if errorlevel 1 (
    echo [ERROR] Failed to create custom format backup!
    pause
    exit /b 1
)

docker cp %CONTAINER_NAME%:/tmp/backup.dump %BACKUP_FILE%.backup
docker exec %CONTAINER_NAME% rm /tmp/backup.dump
echo [SUCCESS] Custom format backup created: %BACKUP_FILE%.backup
echo.

echo [2/2] Creating SQL format backup (human-readable, for inspection)...
docker exec -e PGPASSWORD=%DB_PASSWORD% %CONTAINER_NAME% pg_dump -U %DB_USER% -d %DB_NAME% -F p -f /tmp/backup.sql
if errorlevel 1 (
    echo [ERROR] Failed to create SQL format backup!
    pause
    exit /b 1
)

docker cp %CONTAINER_NAME%:/tmp/backup.sql %BACKUP_FILE%.sql
docker exec %CONTAINER_NAME% rm /tmp/backup.sql
echo [SUCCESS] SQL format backup created: %BACKUP_FILE%.sql
echo.

REM Calcular tamanhos dos arquivos
for %%A in ("%BACKUP_FILE%.backup") do set SIZE_BACKUP=%%~zA
for %%A in ("%BACKUP_FILE%.sql") do set SIZE_SQL=%%~zA

REM Converter bytes para KB
set /a SIZE_BACKUP_KB=%SIZE_BACKUP% / 1024
set /a SIZE_SQL_KB=%SIZE_SQL% / 1024

echo ========================================
echo   Backup Completed Successfully!
echo ========================================
echo.
echo Custom format: %BACKUP_FILE%.backup (%SIZE_BACKUP_KB% KB)
echo SQL format:    %BACKUP_FILE%.sql (%SIZE_SQL_KB% KB)
echo.
echo [TIP] To restore this backup, use: scripts\database\restore-database.bat
echo [TIP] To list all backups, use: scripts\database\list-backups.bat
echo.
popd
pause

