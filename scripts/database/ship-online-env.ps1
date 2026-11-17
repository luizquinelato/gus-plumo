# Sincroniza chaves do PC para .env.online e envia ao VPS (sem .env.prod no servidor).
param(
    [ValidateSet('prod', 'dev')]
    [string]$Keys = 'prod',
    [string]$SshHost = 'root@37.27.37.103',
    [string]$SshKey = "$env:USERPROFILE\.ssh\id_ed25519_plumo",
    [string]$RemotePath = '/opt/gus-plumo/.env.online'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root

$syncPy = Join-Path $PSScriptRoot 'sync-env-keys.py'
if (-not (Test-Path $syncPy)) { throw "sync-env-keys.py não encontrado" }

& python $syncPy --from $Keys --to online --set RUN_MIGRATIONS=0
& python (Join-Path $PSScriptRoot 'validate_env_keys.py') (Join-Path $root '.env.online')
if ($LASTEXITCODE -ne 0) {
    throw ".env.online com chaves inválidas após sync"
}

$localEnv = Join-Path $root '.env.online'
if (-not (Test-Path $localEnv)) { throw ".env.online não encontrado" }

$scpArgs = @()
if (Test-Path $SshKey) {
    $scpArgs += '-i', $SshKey
}
$scpArgs += $localEnv, "${SshHost}:${RemotePath}"

& scp @scpArgs
Write-Host ""
Write-Host "[OK] .env.online enviado para $RemotePath"
Write-Host "No VPS: chmod 600 .env.online"
Write-Host "        git pull  # backups/"
Write-Host "        ./scripts/database/restore-online.sh backups/SEU_ARQUIVO.backup --to online --keys $Keys"
Write-Host "        docker compose --env-file .env.online -f docker-compose.online.yml up -d"