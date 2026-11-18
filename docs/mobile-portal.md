# Mobile vs portal

- **Portal** (`md`+, ≥768px): experiência completa (como hoje).
- **Mobile** (`<768px): somente leitura v1 — Home + todos os **relatórios**; Importar, Cadastro, Fechamentos etc. redirecionam para `/relatorios/extrato`.

Implementação: `DeviceModeContext`, `PortalOnly` (esconde ações de escrita), navegação inferior, drawer no menu.

PWA: `vite-plugin-pwa` no build de produção; “Adicionar à tela inicial” no Android/iOS.

Próximas melhorias: layout card por relatório, mais rotas de leitura.