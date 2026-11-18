# VPS — CLI bash (stack online)

Arquivo: **`plumo-online-rc.sh`**

- Apenas `docker-compose.online.yml` e `.env.online`
- Sem flags de ambiente (`prod`/`dev` são só no PC)

```bash
source scripts/vps/plumo-online-rc.sh   # teste
# ou permanente:
# echo 'source /opt/gus-plumo/scripts/vps/plumo-online-rc.sh' >> ~/.bashrc
```

Documentação completa: [docs/hospedagem-online.md](../../docs/hospedagem-online.md) (Fase 7).