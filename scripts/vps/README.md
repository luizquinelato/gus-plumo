# VPS — CLI bash (stack online)

Arquivo: **`plumo-online-rc.sh`** — comando principal **`gus`** (como o perfil PowerShell no PC).

```bash
gus              # ajuda
gus rat-build    # deploy após git pull
gus cd           # /opt/gus-plumo
```

`plumo` / `e` = só `cd`. Atalhos `dkup`, `rat-build`, … funcionam sem o prefixo `gus`.

```bash
echo '[[ -f /opt/gus-plumo/scripts/vps/plumo-online-rc.sh ]] && source /opt/gus-plumo/scripts/vps/plumo-online-rc.sh' >> ~/.bashrc
```

Documentação completa: [docs/hospedagem-online.md](../../docs/hospedagem-online.md) (Fase 7).