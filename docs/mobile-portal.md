# Mobile vs portal

- **Portal** (`md`+, ≥768px): experiência completa (como hoje).
- **Mobile** (`<768px): somente leitura v1 — Home + todos os **relatórios**; Importar, Cadastro, Fechamentos etc. redirecionam para `/relatorios/extrato`.

Implementação: `DeviceModeContext`, `PortalOnly` (esconde ações de escrita), navegação inferior, drawer no menu.

Rodapé (esquerda → direita): **Mais** · Extrato · **Home** (centro) · Faturas · Saúde.

### Instalar no Android (Chrome)

1. Acesse o site em **HTTPS** (ex.: `https://37-27-37-103.sslip.io`).
2. Menu **⋮** (três pontos) → **Instalar app** ou **Adicionar à tela inicial**.
3. Confirme — o ícone abre em tela cheia (`standalone`).

Se não aparecer “Instalar app”, use **Adicionar à tela inicial** (PWA leve sem service worker até `vite-plugin-pwa` estar no build).

**Menu hambúrguer (v1):** no rodapé, botão **Mais** (☰) abre o drawer lateral com **Home** e **Relatórios** (sem Importar/Cadastro). Atalhos inferiores vão direto às telas. No topo dos relatórios, **⋮** abre exportar e outras ações da tela (não é o menu de navegação).

PWA completo: `vite-plugin-pwa` no build de produção (opcional).

**Mobile (relatórios):** filtros via `MobileReportFilterBar` + bottom sheet; **⋮** no `MobileTopBar` quando houver export/ações; scroll único (`CadastroListPageBody` em `<md`).

- **Extrato:** cards por dia.
- **Faturas:** navegador mês/ano (estilo Projeção); seções por cartão/grupo; lista mobile; agrupamentos preservados.
- **Saúde:** filtros no sheet; gráficos com eixos legíveis no mobile; tabela mês a mês em cards.
- **Projeção mensal:** shell mobile + navegador mês/ano; **calendário em lista por dia** (no grid 7 colunas); detalhe ao tocar no lançamento.
- **Saldo parcelado:** filtros no sheet; export no header; gráfico ajustado; compras em lista de cards.