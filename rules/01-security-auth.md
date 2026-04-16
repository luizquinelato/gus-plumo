# Regras de Segurança e Autenticação

Estas regras são INEGOCIÁVEIS e devem ser aplicadas em todas as interações e geração de código.

## 1. Autenticação Obrigatória
- NENHUMA rota de negócio pode ser pública.
- Todas as rotas do backend devem ser protegidas pelo middleware/dependência de autenticação (`require_authentication`).
- O frontend deve proteger todas as rotas privadas com um componente `ProtectedRoute`.

## 2. Isolamento do Auth Service
- O frontend NUNCA deve se comunicar diretamente com o Auth Service.
- O fluxo de login deve ser: `Frontend -> Backend (/api/v1/auth/login) -> Auth Service -> Backend -> Frontend`.
- O Backend atua como um API Gateway para o Auth Service.

## 3. Multi-tenant Nativo
- TODO dado de negócio (tabelas no banco de dados) DEVE ter a coluna `tenant_id`.
- Todas as queries no backend DEVEM filtrar por `tenant_id` do usuário logado. NUNCA retorne dados de outros tenants.
- A classe base do SQLAlchemy para tabelas de negócio deve ser `AccountBaseEntity` (que já inclui `tenant_id`).

## 4. Gestão de Segredos
- NENHUM secret, API key, token ou senha pode ser hardcoded no código-fonte.
- Todos os segredos devem ser lidos de variáveis de ambiente via `pydantic-settings` (no backend) ou `import.meta.env` (no frontend).

## 5. Controle de Acesso (RBAC)
- Utilize o padrão de Role-Based Access Control (RBAC).
- Valide permissões granulares (ex: `require_permission(Resource.USERS, Action.WRITE)`) nas rotas que modificam dados.
