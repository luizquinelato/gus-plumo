"""
Pacote de modelos do sistema de despesas.
Exporta todos os modelos para facilitar importação.
"""

from app.models.base import Base
from app.models.base_entity import BaseEntity
from app.models.unified_models import (
    Tag, Subtag, Cartao, CreditCardInvoice, BankStatement, TransactionMapping,
    Account, ExpenseSharingSetting, ExpenseTemplate, ExpenseTemplateItem
)
from app.models.auth_models import Tenant, Usuario, Sessao, Permissao, ConfiguracaoSistema, TenantCores
from app.models.import_conflict import (
    ImportConflict, ConflictResolution, ConflictResolutionRequest,
    ImportResultWithConflicts, TagConflict, AmountConflict
)

__all__ = [
    'BaseEntity',
    'Base',
    'Tag',
    'Subtag',
    'Cartao',
    'CreditCardInvoice',
    'BankStatement',
    'TransactionMapping',
    'Account',
    'ExpenseSharingSetting',
    'ExpenseTemplate',
    'ExpenseTemplateItem',
    'Tenant',
    'Usuario',
    'Sessao',
    'Permissao',
    'ConfiguracaoSistema',
    'TenantCores',
    # Import conflict models
    'ImportConflict',
    'ConflictResolution',
    'ConflictResolutionRequest',
    'ImportResultWithConflicts',
    'TagConflict',
    'AmountConflict',
]

