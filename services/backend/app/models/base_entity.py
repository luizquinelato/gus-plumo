"""
Entidade base para todos os modelos do sistema.
Fornece campos comuns de auditoria e controle para todas as tabelas.
Autor: Gus Expenses Platform
Data: 2025-12-19
"""

from sqlalchemy import Column, Integer, Boolean, DateTime, ForeignKey
from datetime import datetime
from zoneinfo import ZoneInfo
import os


def now_utc():
    """
    Retorna o timestamp atual no timezone configurado.
    Por padrão usa America/Sao_Paulo (GMT-3).
    """
    timezone_str = os.getenv('TIMEZONE', 'America/Sao_Paulo')
    return datetime.now(ZoneInfo(timezone_str))


def datetime_default():
    """
    Alias para now_utc() para manter compatibilidade com health-pulse.
    Retorna o timestamp atual no timezone configurado.
    """
    return now_utc()


class BaseEntity:
    """
    Classe base com campos de auditoria para todas as entidades do sistema.

    Campos fornecidos:
    - id: Identificador único da entidade
    - tenant_id: ID do tenant (multi-tenancy)
    - created_by: ID do usuário que criou o registro
    - created_at: Data e hora de criação do registro
    - last_updated_at: Data e hora da última atualização

    NOTA: O campo 'active' NÃO está no BaseEntity.
    Adicione manualmente APÓS last_updated_at nas tabelas que precisam de soft delete:
    - tenants, users, accounts, banks, shared_expense_partners, credit_cards,
      users_sessions, users_permissions, system_settings, tenants_colors
    """

    id = Column(Integer, primary_key=True, autoincrement=True, nullable=False)
    tenant_id = Column(Integer, ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=now_utc)
    last_updated_at = Column(DateTime, nullable=False, default=now_utc, onupdate=now_utc)


class AccountBaseEntity(BaseEntity):
    """
    Classe base para entidades que pertencem a uma conta específica.

    Herda de BaseEntity e adiciona:
    - account_id: ID da conta específica

    Use para: Tags, Subtags, TransactionMappings (configurações por conta)

    ORDEM DOS CAMPOS HERDADOS:
    - account_id (vem ANTES dos campos do BaseEntity)
    - tenant_id
    - created_by
    - created_at
    - last_updated_at
    """

    account_id = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False, index=True)

