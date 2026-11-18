# Mobile vs portal

- **Portal** (`md`+, ≥768px): experiência completa (como hoje).
- **Mobile** (`<768px): somente leitura v1 — Home + todos os **relatórios**; Importar, Cadastro, Fechamentos etc. redirecionam para `/relatorios/extrato`.

Implementação: `DeviceModeContext`, `PortalOnly` (esconde ações de escrita), navegação inferior, drawer no menu.

### Instalar no Android (Chrome)

1. Acesse o site em **HTTPS** (ex.: `https://37-27-37-103.sslip.io`).
2. Menu **⋮** (três pontos) → **Instalar app** ou **Adicionar à tela inicial**.
3. Confirme — o ícone abre em tela cheia (`standalone`).

Se não aparecer “Instalar app”, use **Adicionar à tela inicial** (PWA leve sem service worker até `vite-plugin-pwa` estar no build).

**Menu hambúrguer (v1):** abre o drawer lateral com **Home** e **Relatórios** (sem Importar/Cadastro). Atalhos inferiores vão direto às telas.

PWA completo: `vite-plugin-pwa` no build de produção (opcional).

**Mobile (relatórios):** filtros via `MobileReportFilterBar` + bottom sheet; export (`Download`) no header quando houver; scroll único (`CadastroListPageBody` em `<md`).

- **Extrato:** cards por dia.
- **Faturas:** mantém abas ano/mês e seções por cartão/grupo; lançamentos em lista (sem tabela); agrupamento preservado.
- **Saúde:** filtros ano/mês/escopo no sheet; gráficos rolam com a página.