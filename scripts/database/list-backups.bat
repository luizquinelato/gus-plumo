@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   Gus Expenses Platform - Backup List
echo ========================================
echo.

REM Navegar para a raiz do projeto
pushd %~dp0..\..

REM Verificar se a pasta de backups existe
if not exist "backups" (
    echo [INFO] Backups directory not found.
    echo [INFO] No backups have been created yet.
    echo.
    echo [TIP] Create your first backup with: backup-database.bat
    echo.
    pause
    exit /b 0
)

REM Contar backups
set COUNT_BACKUP=0
set COUNT_SQL=0
set TOTAL_SIZE=0

for %%F in (backups\*.backup) do set /a COUNT_BACKUP+=1
for %%F in (backups\*.sql) do set /a COUNT_SQL+=1

if %COUNT_BACKUP%==0 (
    echo [INFO] No backup files found.
    echo.
    echo [TIP] Create your first backup with: backup-database.bat
    echo.
    pause
    exit /b 0
)

echo Found %COUNT_BACKUP% backup set(s):
echo.
echo ----------------------------------------

REM Listar backups em ordem reversa (mais recentes primeiro)
set INDEX=0
for /f "delims=" %%F in ('dir /b /o-d backups\*.backup 2^>nul') do (
    set /a INDEX+=1
    set FILENAME=%%F
    
    REM Extrair timestamp do nome do arquivo
    REM Formato: expenses_db_YYYY-MM-DD_HH-MM-SS.backup
    set TIMESTAMP=!FILENAME:~12,-7!
    set DATE_PART=!TIMESTAMP:~0,10!
    set TIME_PART=!TIMESTAMP:~11!
    set TIME_PART=!TIME_PART:-=:!
    
    REM Obter tamanho do arquivo .backup
    for %%A in ("backups\%%F") do set SIZE_BACKUP=%%~zA
    set /a SIZE_BACKUP_KB=!SIZE_BACKUP! / 1024
    
    REM Verificar se existe o arquivo .sql correspondente
    set SQL_FILE=!FILENAME:.backup=.sql!
    set SQL_INFO=
    if exist "backups\!SQL_FILE!" (
        for %%A in ("backups\!SQL_FILE!") do set SIZE_SQL=%%~zA
        set /a SIZE_SQL_KB=!SIZE_SQL! / 1024
        set SQL_INFO=+ SQL (!SIZE_SQL_KB! KB^)
    )
    
    echo [!INDEX!] !DATE_PART! !TIME_PART!
    echo     Custom: !SIZE_BACKUP_KB! KB !SQL_INFO!
    echo     File: %%F
    echo.
    
    set /a TOTAL_SIZE+=!SIZE_BACKUP!
    if defined SIZE_SQL set /a TOTAL_SIZE+=!SIZE_SQL!
)

echo ----------------------------------------
set /a TOTAL_SIZE_MB=%TOTAL_SIZE% / 1024 / 1024
echo Total: %COUNT_BACKUP% backup set(s), ~%TOTAL_SIZE_MB% MB
echo.
echo [TIP] To create a new backup: scripts\database\backup-database.bat
echo [TIP] To restore a backup: scripts\database\restore-database.bat
echo.
popd
pause

