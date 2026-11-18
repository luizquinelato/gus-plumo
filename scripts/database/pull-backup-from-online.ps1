# Baixa backups/plumo_online_* do VPS para backups\ local (WinSCP/pscp alternativa).
param(
    [string]$SshHost = 'root@37.27.37.103',
    [string]$SshKey = "$env:USERPROFILE\.ssh\id_ed25519_plumo",
    [string]$RemoteDir = '/opt/gus-plumo/backups',
    [string]$LocalDir = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $LocalDir) { $LocalDir = Join-Path $root 'backups' }
New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null

$scpArgs = @()
if (Test-Path $SshKey) { $scpArgs += '-i', $SshKey }

$patterns = @('plumo_online_*.backup', 'plumo_online_*.sql', 'plumo_online_*.meta')
foreach ($pat in $patterns) {
    $remote = "${SshHost}:${RemoteDir}/$pat"
    Write-Host "scp $remote ..."
    & scp @scpArgs $remote $LocalDir 2>$null
}

Write-Host ""
Write-Host "[OK] Arquivos em $LocalDir"
Write-Host "Restore local:"
Write-Host "  python scripts\database\sync-env-keys.py --from online --to prod"
Write-Host "  .\scripts\database\restore-database.bat backups\plumo_online_....backup --to prod --keys online"