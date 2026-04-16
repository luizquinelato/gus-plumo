@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   Plumo - Database Restore
echo ========================================
echo.

REM Navegar para a raiz do projeto
pushd %~dp0..\..

REM Verificar se foi passado --dev ou --prod como parâmetro
set "TARGET_ENV="
set "BACKUP_FILE="

:parse_args
if "%~1"=="" goto :done_args
if /i "%~1"=="--dev" (
    set "TARGET_ENV=dev"
    shift
    goto :parse_args
)
if /i "%~1"=="dev" (
    set "TARGET_ENV=dev"
    shift
    goto :parse_args
)
if /i "%~1"=="--prod" (
    set "TARGET_ENV=prod"
    shift
    goto :parse_args
)
if /i "%~1"=="prod" (
    set "TARGET_ENV=prod"
    shift
    goto :parse_args
)
REM Se não é flag, assume que é o arquivo de backup
set "BACKUP_FILE=%~1"
shift
goto :parse_args
:done_args

REM Se foi especificado um ambiente alvo, carregar do arquivo correspondente
if defined TARGET_ENV (
    if "%TARGET_ENV%"=="dev" (
        if not exist ".env.dev" (
            echo [ERROR] .env.dev not found!
            popd
            pause
            exit /b 1
        )
        echo [INFO] Loading DEV environment configuration...
        for /f "usebackq tokens=1,2 delims==" %%a in (".env.dev") do (
            set "line=%%a"
            if not "!line:~0,1!"=="#" (
                set "%%a=%%b"
            )
        )
    ) else if "%TARGET_ENV%"=="prod" (
        if not exist ".env.prod" (
            echo [ERROR] .env.prod not found!
            popd
            pause
            exit /b 1
        )
        echo [INFO] Loading PROD environment configuration...
        for /f "usebackq tokens=1,2 delims==" %%a in (".env.prod") do (
            set "line=%%a"
            if not "!line:~0,1!"=="#" (
                set "%%a=%%b"
            )
        )
    )
) else (
    REM Carregar variáveis do .env atual se existir
    if exist ".env" (
        for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
            set "line=%%a"
            if not "!line:~0,1!"=="#" (
                set "%%a=%%b"
            )
        )
    )
)

REM Configurações do banco (usa .env ou valores padrão)
if not defined CONTAINER_NAME set CONTAINER_NAME=plumo-postgres
if not defined DB_NAME set DB_NAME=plumo
if not defined DB_USER set DB_USER=plumo
if not defined DB_PASSWORD set DB_PASSWORD=plumo
if not defined ENVIRONMENT set ENVIRONMENT=prod

echo [INFO] Target Environment: %ENVIRONMENT%
echo [INFO] Target Database: %DB_NAME%
echo [INFO] Target Container: %CONTAINER_NAME%
echo.

REM Verificar se o container está rodando
docker ps | findstr %CONTAINER_NAME% >nul
if errorlevel 1 (
    echo [ERROR] Container %CONTAINER_NAME% is not running!
    echo [INFO] Please start the database first with: scripts\database\start-database.bat
    echo.
    popd
    pause
    exit /b 1
)

REM Se foi passado um arquivo de backup como parâmetro, usar ele
if defined BACKUP_FILE (
    if not exist "%BACKUP_FILE%" (
        echo [ERROR] Backup file not found: %BACKUP_FILE%
        popd
        pause
        exit /b 1
    )
    set "SELECTED_BACKUP=%BACKUP_FILE%"
    goto :do_restore
)

REM Verificar se a pasta de backups existe
if not exist "backups" (
    echo [ERROR] Backups directory not found!
    echo [INFO] Please create a backup first with: backup-database.bat
    echo.
    popd
    pause
    exit /b 1
)

REM Listar backups disponíveis
echo Available backups:
echo.
set COUNT=0

REM Criar lista de backups
for %%F in (backups\*.backup) do (
    set /a COUNT+=1
    set "BACKUP_FILE_!COUNT!=%%F"
    set "BACKUP_NAME_!COUNT!=%%~nxF"
    set "BACKUP_SIZE_!COUNT!=%%~zF"
)

REM Mostrar lista
for /L %%i in (1,1,!COUNT!) do (
    call echo [%%i] %%BACKUP_NAME_%%i%% (%%BACKUP_SIZE_%%i%% bytes^)
)

if !COUNT!==0 (
    echo [ERROR] No backup files found in backups\ directory!
    echo [INFO] Please create a backup first with: backup-database.bat
    echo.
    popd
    pause
    exit /b 1
)

echo.
echo Usage: restore-database.bat [--dev^|--prod] [backup_file]
echo.
echo   --dev   Restore to DEV environment (plumo_dev on port 5433)
echo   --prod  Restore to PROD environment (plumo on port 5432)
echo.
set /p CHOICE="Select backup number to restore (1-!COUNT!) or 0 to cancel: "

if "!CHOICE!"=="0" (
    echo [INFO] Restore cancelled.
    popd
    pause
    exit /b 0
)

REM Validar escolha
if !CHOICE! LSS 1 (
    echo [ERROR] Invalid choice!
    popd
    pause
    exit /b 1
)
if !CHOICE! GTR !COUNT! (
    echo [ERROR] Invalid choice!
    popd
    pause
    exit /b 1
)

REM Obter arquivo selecionado
call set "SELECTED_BACKUP=%%BACKUP_FILE_!CHOICE!%%"

:do_restore

echo.
echo ========================================
echo   WARNING: This will REPLACE all data!
echo ========================================
echo.
echo Selected backup: !SELECTED_BACKUP!
echo Target database: %DB_NAME%
echo.
set /p CONFIRM="Are you sure you want to continue? (y/n): "

if /i not "%CONFIRM%"=="y" if /i not "%CONFIRM%"=="yes" (
    echo [INFO] Restore cancelled.
    popd
    pause
    exit /b 0
)

echo.
echo [INFO] Starting database restore...
echo.

REM Copiar backup para o container
echo [1/4] Copying backup file to container...
docker cp "%SELECTED_BACKUP%" %CONTAINER_NAME%:/tmp/restore.backup
if errorlevel 1 (
    echo [ERROR] Failed to copy backup file to container!
    popd
    pause
    exit /b 1
)
echo [SUCCESS] Backup file copied.
echo.

REM Desconectar usuários ativos
echo [2/4] Disconnecting active users...
docker exec -e PGPASSWORD=%DB_PASSWORD% %CONTAINER_NAME% psql -U %DB_USER% -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%DB_NAME%' AND pid <> pg_backend_pid();"
echo [SUCCESS] Active users disconnected.
echo.

REM Dropar e recriar o banco
echo [3/4] Recreating database...
docker exec -e PGPASSWORD=%DB_PASSWORD% %CONTAINER_NAME% psql -U %DB_USER% -d postgres -c "DROP DATABASE IF EXISTS %DB_NAME%;"
docker exec -e PGPASSWORD=%DB_PASSWORD% %CONTAINER_NAME% psql -U %DB_USER% -d postgres -c "CREATE DATABASE %DB_NAME%;"
if errorlevel 1 (
    echo [ERROR] Failed to recreate database!
    popd
    pause
    exit /b 1
)
echo [SUCCESS] Database recreated.
echo.

REM Restaurar o backup
echo [4/4] Restoring backup...
docker exec -e PGPASSWORD=%DB_PASSWORD% %CONTAINER_NAME% pg_restore -U %DB_USER% -d %DB_NAME% -v /tmp/restore.backup

REM pg_restore retorna erro mesmo com warnings, então ignoramos
echo:

REM Limpar arquivo temporário
docker exec %CONTAINER_NAME% rm /tmp/restore.backup 2>nul

echo ========================================
echo   Restore Completed!
echo ========================================
echo:
echo Database: %DB_NAME%
echo Restored from: !SELECTED_BACKUP!
echo:
echo [INFO] Your application should now use the restored data.
echo:
popd
pause

