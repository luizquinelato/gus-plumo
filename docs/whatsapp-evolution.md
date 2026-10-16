# WhatsApp (Evolution API)

O Plumo envia mensagens de WhatsApp pela **Evolution API v2** (cliente não oficial, via Baileys). A mensagem sai do número que escanear o QR code, como um "aparelho conectado".

> Risco: é um caminho não oficial e o WhatsApp pode banir o número. Evite volume alto de mensagens.

## Onde é usado

- Projeção mensal: botão de WhatsApp ao lado de "Lançar" (`POST /api/monthly-projections/send-whatsapp`).
- Balanço compartilhado: envio do resumo dos fechamentos abertos de uma conta compartilhada.
- Cliente HTTP: `services/backend/app/services/whatsapp_service.py`.

## Variáveis de ambiente

Em `.env.dev` e `.env.prod` (mesmos valores nos dois por enquanto):

| Variável | Descrição |
|---|---|
| `EVOLUTION_API_URL` | `http://localhost:8080` |
| `EVOLUTION_API_KEY` | Chave global da Evolution (48 caracteres hexadecimais) |
| `EVOLUTION_INSTANCE` | Nome da instância (`plumo`) |
| `WHATSAPP_DEFAULT_TO` | Destino padrão: DDI + DDD + número, sem `+` (ex.: `5519997033858`). Para grupo, `id@g.us` |
| `WHATSAPP_SHARED_BALANCE_EXTRA_TO` | Segundo destino do resumo do balanço compartilhado (ex.: `5519999203010`) |

Gerar uma chave nova (grava só se `EVOLUTION_API_KEY` ainda não existir; não imprime o valor):

```powershell
$key = -join ((48..57)+(97..102) | Get-Random -Count 48 | ForEach-Object {[char]$_})
Add-Content .env.dev "EVOLUTION_API_KEY=$key"
```

Se mudar a chave depois, recrie o container (ela entra como `AUTHENTICATION_API_KEY`).

## Subir a Evolution

Arquivo: `docker-compose.evolution.yml` (Evolution `v2.3.6` + Postgres próprio, sem Redis, porta 8080).

```powershell
docker compose --env-file .env.dev -f docker-compose.evolution.yml up -d
docker logs --tail 50 plumo_evolution_api
```

`--env-file` serve para o compose ler `EVOLUTION_API_KEY`. Confirme em `http://localhost:8080` (JSON de boas-vindas).

Não use a imagem `v2.3.7`: o WhatsApp recusou o QR code nessa versão.

## Criar a instância e conectar o número

Rode no PowerShell, na raiz do projeto. O comando lê a chave do `.env.dev` sem exibi-la:

```powershell
$key = ((Get-Content .env.dev | Where-Object { $_ -match '^EVOLUTION_API_KEY=' }) -split '=',2)[1]
Invoke-RestMethod -Method Post -Uri http://localhost:8080/instance/create `
  -Headers @{ apikey = $key } -ContentType 'application/json' `
  -Body '{"instanceName":"plumo","integration":"WHATSAPP-BAILEYS","qrcode":true}'
```

Depois:

1. Abra `http://localhost:8080/manager`, informe a chave do `.env.dev` e abra a instância `plumo`.
2. No celular do número remetente: WhatsApp > *Aparelhos conectados* > *Conectar um aparelho* e escaneie o QR.
3. Se o `/manager` não mostrar o QR: `Invoke-RestMethod -Uri http://localhost:8080/instance/connect/plumo -Headers @{ apikey = $key }` (QR em base64 no campo `base64`).
4. Reinicie o backend para ele ler as variáveis.

## Operação

- A sessão fica nos volumes `evolution_instances` e `evolution_pgdata`. Não rode `docker compose ... down -v`: isso apaga a sessão e exige novo QR.
- Parar/subir sem perder a sessão: `docker compose --env-file .env.dev -f docker-compose.evolution.yml stop` / `up -d`.
- Apagar a instância: `Invoke-RestMethod -Method Delete -Uri http://localhost:8080/instance/delete/plumo -Headers @{ apikey = $key }`.

## Problemas comuns

| Sintoma | Causa provável / ação |
|---|---|
| WhatsApp recusa o QR ("não foi possível conectar") | Imagem `v2.3.7`. Use `v2.3.6`. Se persistir, apague a instância, remova o aparelho pendente no celular e crie de novo. Alternativa: fixar `CONFIG_SESSION_PHONE_VERSION` (versão em wppconnect.io/whatsapp-versions, sem `-alpha`); não combinar com a `v2.3.6`. |
| 401 ao criar a instância | A chave do `.env.dev` difere da `AUTHENTICATION_API_KEY` do container. Recrie o container. |
| Erro de conexão em `localhost:8080` | Container parado: `docker ps`. |
| 503 no endpoint do Plumo | Variável `EVOLUTION_*` ou `WHATSAPP_DEFAULT_TO` ausente, ou backend não reiniciado. |
| 502 "Evolution API recusou o envio" | Instância desconectada (refaça o QR) ou número inválido. |
