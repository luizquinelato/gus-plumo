# VPS — CLI bash (stack online)

Arquivo: **`plumo-online-rc.sh`** — comando principal **`gus`** (como o perfil PowerShell no PC).

```bash
gus              # ajuda
gus rat-build    # deploy após git pull
gus cd           # /opt/gus-plumo
```

`plumo` / `e` = só `cd`. Atalhos `dkup`, `rat-build`, … funcionam sem o prefixo `gus`.

### Opção A — `gus` no PATH (recomendado, sem `source`)

Depois de `git pull` no VPS:

```bash
sudo install -m 755 /opt/gus-plumo/scripts/vps/gus /usr/local/bin/gus
gus --help
```

Funciona em **qualquer pasta** e em qualquer nova sessão SSH.

### Opção B — funções no shell (`source` no `.bashrc`)

```bash
echo '[[ -f /opt/gus-plumo/scripts/vps/plumo-online-rc.sh ]] && source /opt/gus-plumo/scripts/vps/plumo-online-rc.sh' >> ~/.bashrc
```

Útil se quiser atalhos soltos (`rat-build` sem `gus`). Pode usar **A + B** juntos.

Documentação completa: [docs/hospedagem-online.md](../../docs/hospedagem-online.md) (Fase 7).