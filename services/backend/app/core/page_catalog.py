# -*- coding: utf-8 -*-
"""Catálogo de páginas do Plumo (sincronizar seed da migration 0033 e frontend pageCatalog.ts)."""

from typing import List, TypedDict


class PageDef(TypedDict):
    page_key: str
    route: str
    label: str
    group_label: str
    sort_order: int
    admin_only: bool


# Rotas com subcaminhos usam prefix match no frontend (ex.: fechamentos.compartilhado).
PLUMO_APP_PAGES: List[PageDef] = [
    {"page_key": "home", "route": "/", "label": "Home", "group_label": "Principal", "sort_order": 10, "admin_only": False},
    {"page_key": "importar", "route": "/importar", "label": "Importar", "group_label": "Principal", "sort_order": 20, "admin_only": False},
    {"page_key": "configuracoes.cartoes", "route": "/configuracoes/cartoes", "label": "Cartões", "group_label": "Cadastro", "sort_order": 100, "admin_only": False},
    {"page_key": "configuracoes.contas", "route": "/configuracoes/contas", "label": "Contas", "group_label": "Cadastro", "sort_order": 110, "admin_only": False},
    {"page_key": "configuracoes.compartilhamentos", "route": "/configuracoes/compartilhamentos", "label": "Compartilhamentos", "group_label": "Cadastro", "sort_order": 120, "admin_only": False},
    {"page_key": "configuracoes.tags", "route": "/configuracoes/tags-subtags", "label": "Tags & Subtags", "group_label": "Cadastro", "sort_order": 130, "admin_only": False},
    {"page_key": "cadastro.mappings", "route": "/mappings", "label": "Mapeamentos", "group_label": "Cadastro", "sort_order": 140, "admin_only": False},
    {"page_key": "cadastro.templates", "route": "/templates", "label": "Templates", "group_label": "Cadastro", "sort_order": 150, "admin_only": False},
    {"page_key": "relatorios.extrato", "route": "/relatorios/extrato", "label": "Extrato", "group_label": "Relatórios", "sort_order": 200, "admin_only": False},
    {"page_key": "relatorios.faturas", "route": "/relatorios/faturas", "label": "Faturas", "group_label": "Relatórios", "sort_order": 210, "admin_only": False},
    {"page_key": "relatorios.grupo", "route": "/relatorios/grupo", "label": "Grupo", "group_label": "Relatórios", "sort_order": 220, "admin_only": False},
    {"page_key": "relatorios.projecao", "route": "/relatorios/projecao-mensal", "label": "Projeção Mensal", "group_label": "Relatórios", "sort_order": 230, "admin_only": False},
    {"page_key": "relatorios.saldo_parcelado", "route": "/relatorios/saldo-parcelado", "label": "Saldo Parcelado", "group_label": "Relatórios", "sort_order": 240, "admin_only": False},
    {"page_key": "relatorios.saude", "route": "/relatorios/saude", "label": "Saúde Financeira", "group_label": "Relatórios", "sort_order": 250, "admin_only": False},
    {"page_key": "fechamentos.conta", "route": "/fechamentos/conta", "label": "Fechamento Conta", "group_label": "Fechamentos", "sort_order": 300, "admin_only": False},
    {"page_key": "fechamentos.compartilhado", "route": "/fechamentos/compartilhado", "label": "Fechamento Compartilhado", "group_label": "Fechamentos", "sort_order": 310, "admin_only": False},
    {"page_key": "fechamentos.faturas", "route": "/fechamentos/faturas", "label": "Reconciliação de Faturas", "group_label": "Fechamentos", "sort_order": 320, "admin_only": False},
    {"page_key": "curadoria", "route": "/curadoria", "label": "Curadoria", "group_label": "Operação", "sort_order": 400, "admin_only": False},
    {"page_key": "emprestimos", "route": "/emprestimos", "label": "Empréstimos", "group_label": "Operação", "sort_order": 410, "admin_only": False},
    {"page_key": "informes", "route": "/informes", "label": "Informes", "group_label": "Operação", "sort_order": 420, "admin_only": False},
    {"page_key": "consorcios", "route": "/consorcios", "label": "Consórcios", "group_label": "Operação", "sort_order": 430, "admin_only": False},
    {"page_key": "configuracoes.copy", "route": "/configuracoes/copy-settings", "label": "Copiar Configurações", "group_label": "Configurações", "sort_order": 500, "admin_only": True},
    {"page_key": "configuracoes.cores", "route": "/configuracoes/cores", "label": "Cores", "group_label": "Configurações", "sort_order": 510, "admin_only": True},
    {"page_key": "configuracoes.acessos", "route": "/configuracoes/acessos", "label": "Acessos", "group_label": "Configurações", "sort_order": 515, "admin_only": True},
    {"page_key": "configuracoes.usuarios", "route": "/configuracoes/usuarios", "label": "Usuários", "group_label": "Configurações", "sort_order": 520, "admin_only": True},
]

GRANTABLE_PAGE_KEYS = {p["page_key"] for p in PLUMO_APP_PAGES if not p["admin_only"]}