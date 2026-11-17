# Só sync local: chaves de prod/dev → .env.online (sem scp).
param(
    [ValidateSet('prod', 'dev')]
    [string]$Keys = 'prod',
    [switch]$ForRestore
)
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root
$extra = @()
if ($ForRestore) { $extra = @('--set', 'RUN_MIGRATIONS=0') }
python (Join-Path $PSScriptRoot 'sync-env-keys.py') --from $Keys --to online @extra
Write-Host "Publicar no VPS: .\scripts\database\ship-online-env.ps1 -Keys $Keys"