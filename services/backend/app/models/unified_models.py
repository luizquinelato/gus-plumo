"""
Modelos unificados para o sistema de despesas.
Contém as definições das tabelas de categorias, subcategorias e mapeamento de despesas.
Autor: Gus Expenses Platform
Data: 2025-12-19
"""

from decimal import Decimal
from sqlalchemy import Column, Integer, BigInteger, String, ForeignKey, Text, Numeric, Date, DateTime, CheckConstraint, Boolean, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.models.base_entity import BaseEntity, AccountBaseEntity, now_utc


class Bank(Base):
    """
    Modelo para bancos brasileiros.

    Representa os bancos cadastrados no sistema com código COMPE e ISPB.
    Não herda de BaseEntity (sem tenant_id).
    """
    __tablename__ = 'banks'
    __table_args__ = {'quote': False}

    # 1. Campos de negócio
    id = Column(Integer, primary_key=True, autoincrement=True, nullable=False)
    code = Column(String(10), nullable=False, unique=True, name="code")
    name = Column(String(100), nullable=False, name="name")
    full_name = Column(String(255), nullable=True, name="full_name")
    ispb = Column(String(10), nullable=True, name="ispb")

    # 2. Campos de auditoria (manual, sem tenant_id)
    created_at = Column(DateTime, nullable=False, default=now_utc, name="created_at")
    last_updated_at = Column(DateTime, nullable=False, default=now_utc, onupdate=now_utc, name="last_updated_at")

    # 3. Active
    active = Column(Boolean, nullable=False, default=True, name="active")

    # Relacionamentos
    accounts = relationship("Account", back_populates="bank")


class Account(Base, BaseEntity):
    """
    Modelo para contas bancárias dos usuários.

    Representa as contas bancárias reais (ex: Conta Itaú, Conta Nubank).
    Cada conta pertence a um usuário e pode ter múltiplos cartões, parceiros e terceiros associados.
    """
    __tablename__ = 'accounts'
    __table_args__ = {'quote': False}

    # 1. Campos de negócio
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, name="user_id", index=True)
    name = Column(String(100), nullable=True, name="name")
    description = Column(Text, nullable=True, name="description")
    account_type = Column(String(50), nullable=True, name="account_type")  # 'checking', 'savings', 'investment'
    bank_id = Column(Integer, ForeignKey('banks.id', ondelete='RESTRICT'), nullable=True, name="bank_id")
    agency = Column(Integer, nullable=True, name="agency")
    account_number = Column(BigInteger, nullable=True, name="account_number")

    # 2. Campos do BaseEntity (herdados: id, tenant_id, created_by, created_at, last_updated_at)

    # 3. Active
    active = Column(Boolean, nullable=False, default=True, name="active")

    # Relacionamentos
    user = relationship("Usuario", foreign_keys=[user_id])
    bank = relationship("Bank", back_populates="accounts")
    expense_sharing_settings = relationship("ExpenseSharingSetting", foreign_keys="[ExpenseSharingSetting.account_id]", cascade="all, delete-orphan")
    credit_cards = relationship("Cartao", back_populates="account")
    bank_statements = relationship("BankStatement", back_populates="account", primaryjoin="Account.id == BankStatement.account_id")
    tags = relationship("Tag", back_populates="account")
    subtags = relationship("Subtag", back_populates="account")
    transaction_mappings = relationship("TransactionMapping", back_populates="account")


class ExpenseSharingSetting(Base, AccountBaseEntity):
    """
    Configurações de compartilhamento de despesas entre contas.

    Define como despesas de uma conta (account_id) podem ser compartilhadas
    com outra conta (shared_account_id) do mesmo tenant.

    - my_contribution_percentage = 0%: Outra conta paga 100%
    - my_contribution_percentage = 50%: Compartilhado meio a meio
    - my_contribution_percentage = 100%: Eu pago 100%

    Cada configuração é única por par de contas (account_id + shared_account_id).
    Não há duplicação - cada conta configura seus próprios compartilhamentos.
    """
    __tablename__ = 'expense_sharing_settings'
    __table_args__ = {'quote': False}

    # Campos específicos (na ordem: id, shared_account_id, my_contribution_percentage, description, account_id, tenant_id, created_by, created_at, last_updated_at, active)
    shared_account_id = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False, name="shared_account_id", index=True)
    my_contribution_percentage = Column(Numeric(5, 2), nullable=False, default=Decimal("50.00"), name="my_contribution_percentage")
    description = Column(Text, nullable=True, name="description")

    # Campos herdados de AccountBaseEntity: id, tenant_id, account_id, created_by, created_at, last_updated_at

    # Active (soft delete)
    active = Column(Boolean, nullable=False, default=True, name="active")

    # Relacionamentos
    account = relationship("Account", foreign_keys="[ExpenseSharingSetting.account_id]", back_populates="expense_sharing_settings")
    shared_account = relationship("Account", foreign_keys=[shared_account_id])
    credit_cards = relationship("Cartao", back_populates="expense_sharing")
    credit_card_invoices = relationship("CreditCardInvoice", back_populates="expense_sharing")
    bank_statements = relationship("BankStatement", back_populates="expense_sharing")
    benefit_card_statements = relationship("BenefitCardStatement", back_populates="expense_sharing")
    transaction_mappings = relationship("TransactionMapping", back_populates="expense_sharing")


class Tag(Base, AccountBaseEntity):
    """
    Modelo para tags (categorias) genéricas.

    Representa as tags principais (ex: Alimentação, Transporte, Saúde, Cartão).
    Cada tag pode ter múltiplas subtags associadas.
    Tags são genéricas e podem ter subtags de receita E despesa.
    Configurações específicas por conta.
    """
    __tablename__ = 'tags'
    __table_args__ = {'quote': False}

    # 1. Campos de negócio
    name = Column(String(100), nullable=False, name="name")
    description = Column(Text, nullable=True, name="description")
    icon = Column(String(50), nullable=True, default='Tag', name="icon")

    # 2. Campos do AccountBaseEntity (herdados: id, account_id, tenant_id, created_by, created_at, last_updated_at)

    # 3. SEM active (hard delete)

    # Relacionamentos
    account = relationship("Account", back_populates="tags")
    subtags = relationship("Subtag", back_populates="tag", cascade="all, delete-orphan")


class Subtag(Base, AccountBaseEntity):
    """
    Modelo para subtags (subcategorias).

    Representa subdivisões dentro de uma tag (ex: Restaurante, Supermercado dentro de Alimentação).
    Cada subtag pertence a uma tag e possui um tipo (receita ou despesa).
    Configurações específicas por conta.
    """
    __tablename__ = 'subtags'
    __table_args__ = {'quote': False}

    # 1. Campos de negócio
    tag_id = Column(Integer, ForeignKey('tags.id', ondelete='CASCADE'), nullable=False, name="tag_id", index=True)
    name = Column(String(100), nullable=False, name="name")
    description = Column(Text, nullable=True, name="description")
    type = Column(String(20), nullable=False, name="type")  # 'receita' ou 'despesa'
    icon = Column(String(50), nullable=True, default='Tags', name="icon")

    # 2. Campos do AccountBaseEntity (herdados: id, account_id, tenant_id, created_by, created_at, last_updated_at)

    # 3. SEM active (hard delete)

    # Relacionamentos
    account = relationship("Account", back_populates="subtags")
    tag = relationship("Tag", back_populates="subtags")


class Cartao(Base, BaseEntity):
    """
    Modelo para cartões de crédito.

    Representa os cartões de crédito cadastrados no sistema.
    Cada cartão possui um nome, descrição, número (últimos 4 dígitos),
    tipo (crédito ou benefícios), e configurações de propriedade (próprio, compartilhado).

    NOTA: ownership_type é uma propriedade CALCULADA baseada em:
    - proprio: shared_partner_id IS NULL
    - compartilhado: shared_partner_id IS NOT NULL
    """
    __tablename__ = 'credit_cards'
    __table_args__ = (
        CheckConstraint("type IN ('credito', 'beneficios')", name='chk_credit_cards_type'),
        CheckConstraint("closing_day >= 1 AND closing_day <= 30", name='chk_credit_cards_closing_day'),
        {'quote': False}
    )

    # 1. Campos de negócio
    name = Column(String(100), nullable=False, name="name")
    description = Column(String(255), nullable=True, name="description")
    number = Column(String(4), nullable=False, name="number")
    type = Column(String(20), nullable=False, default='credito', name="type")
    closing_day = Column(Integer, nullable=False, default=14, name="closing_day")
    account_id = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=True, name="account_id", index=True)
    expense_sharing_id = Column(Integer, ForeignKey('expense_sharing_settings.id'), nullable=True, name="expense_sharing_id")

    # 2. Campos do BaseEntity (herdados: id, tenant_id, created_by, created_at, last_updated_at)

    # 3. Active
    active = Column(Boolean, nullable=False, default=True, name="active")

    # Relacionamentos
    account = relationship("Account", back_populates="credit_cards")
    expense_sharing = relationship("ExpenseSharingSetting", back_populates="credit_cards")
    invoices = relationship("CreditCardInvoice", back_populates="credit_card")
    benefit_statements = relationship("BenefitCardStatement", back_populates="credit_card")

    @property
    def ownership_type(self) -> str:
        """
        Deriva o ownership_type baseado no expense_sharing_id.

        Returns:
            str: 'compartilhado' se tem configuração de compartilhamento (expense_sharing_id não nulo),
                 'proprio' se não tem configuração
        """
        if self.expense_sharing_id is not None:
            return 'compartilhado'
        return 'proprio'


class CreditCardInvoice(Base, BaseEntity):
    """
    Modelo para faturas de cartão de crédito.

    Armazena os lançamentos individuais das faturas de cartão.
    credit_card_id: FK para credit_cards (referência ao cartão)
    year_month: Ano/mês da fatura no formato YYYY-MM (ex: 2025-01)
    date: Data da transação individual
    current_installment: Número da parcela atual (ex: 3 em "3/12"). NULL para compras à vista.
    total_installments: Total de parcelas (ex: 12 em "3/12"). NULL para compras à vista.

    IMPORTANTE: adjustment_type é DERIVADO automaticamente:
    - proprio: shared_partner_id IS NULL
    - compartilhado: shared_partner_id IS NOT NULL (use ownership_percentage para definir % de propriedade)
    """
    __tablename__ = 'credit_card_invoices'
    __table_args__ = (
        CheckConstraint("ownership_percentage >= 0 AND ownership_percentage <= 100", name='chk_invoices_ownership_percentage'),
        {'quote': False}
    )

    credit_card_id = Column(Integer, ForeignKey('credit_cards.id'), nullable=False, name="credit_card_id")
    year_month = Column(String(7), nullable=False, name="year_month")
    date = Column(DateTime, nullable=False, name="date")
    description = Column(Text, nullable=False, name="description")
    amount = Column(Numeric(10, 2), nullable=False, name="amount")
    current_installment = Column(Integer, nullable=True, name="current_installment")
    total_installments = Column(Integer, nullable=True, name="total_installments")
    subtag_id = Column(Integer, ForeignKey('subtags.id'), nullable=True, name="subtag_id")
    ownership_percentage = Column(Numeric(5, 2), nullable=False, default=100.00, name="ownership_percentage")
    expense_sharing_id = Column(Integer, ForeignKey('expense_sharing_settings.id'), nullable=True, name="expense_sharing_id")
    adjustment_notes = Column(Text, nullable=True, name="adjustment_notes")
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True, name="account_id")

    # Relacionamentos
    credit_card = relationship("Cartao", back_populates="invoices")
    subtag = relationship("Subtag")
    expense_sharing = relationship("ExpenseSharingSetting", back_populates="credit_card_invoices")
    account = relationship("Account")

    @property
    def adjustment_type(self) -> str:
        """Deriva o adjustment_type baseado no ownership_percentage da configuração de compartilhamento."""
        if self.expense_sharing_id is not None and self.expense_sharing:
            if self.expense_sharing.my_contribution_percentage == 0:
                return 'terceiro'
            elif 0 < self.expense_sharing.my_contribution_percentage < 100:
                return 'compartilhado'
        return 'proprio'


class BankStatement(Base, BaseEntity):
    """
    Modelo para extratos bancários.

    Armazena os lançamentos de extratos bancários importados.
    Herda de BaseEntity para ter campos de auditoria.

    IMPORTANTE: adjustment_type é DERIVADO automaticamente:
    - proprio: shared_partner_id IS NULL
    - compartilhado: shared_partner_id IS NOT NULL (use ownership_percentage para definir % de propriedade)
    """
    __tablename__ = 'bank_statements'
    __table_args__ = (
        CheckConstraint("ownership_percentage >= 0 AND ownership_percentage <= 100", name='chk_statements_ownership_percentage'),
        {'quote': False}
    )

    category = Column(String(100), nullable=True, name="category")
    transaction = Column(String(100), nullable=True, name="transaction")
    description = Column(Text, nullable=False, name="description")
    date = Column(DateTime, nullable=False, name="date")
    amount = Column(Numeric(10, 2), nullable=False, name="amount")
    subtag_id = Column(Integer, ForeignKey('subtags.id'), nullable=True, name="subtag_id")
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True, name="account_id")
    ownership_percentage = Column(Numeric(5, 2), nullable=False, default=100.00, name="ownership_percentage")
    expense_sharing_id = Column(Integer, ForeignKey('expense_sharing_settings.id'), nullable=True, name="expense_sharing_id")
    adjustment_notes = Column(Text, nullable=True, name="adjustment_notes")
    # Campos de rastreamento para itens migrados por inversão de compartilhamento
    migrated_from_account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True, name="migrated_from_account_id")
    migrated_from_table = Column(String(50), nullable=True, name="migrated_from_table")  # 'credit_card_invoices' ou 'benefit_card_statements'

    # Relacionamentos
    subtag = relationship("Subtag")
    account = relationship("Account", back_populates="bank_statements", foreign_keys=[account_id])
    migrated_from_account = relationship("Account", foreign_keys=[migrated_from_account_id])
    expense_sharing = relationship("ExpenseSharingSetting", back_populates="bank_statements")

    @property
    def adjustment_type(self) -> str:
        """Deriva o adjustment_type baseado no ownership_percentage da configuração de compartilhamento."""
        if self.expense_sharing_id is not None and self.expense_sharing:
            if self.expense_sharing.my_contribution_percentage == 0:
                return 'terceiro'
            elif 0 < self.expense_sharing.my_contribution_percentage < 100:
                return 'compartilhado'
        return 'proprio'


class BenefitCardStatement(Base, BaseEntity):
    """
    Modelo para extratos de cartões de benefícios.

    Armazena os lançamentos de extratos de cartões de benefícios (Flash, VR, etc).
    Formato CSV: Data,Hora,Movimentação,Valor,Meio de Pagamento,Saldo

    IMPORTANTE: adjustment_type é DERIVADO automaticamente:
    - proprio: shared_partner_id IS NULL
    - compartilhado: shared_partner_id IS NOT NULL (use ownership_percentage para definir % de propriedade)
    """
    __tablename__ = 'benefit_card_statements'
    __table_args__ = (
        CheckConstraint("ownership_percentage >= 0 AND ownership_percentage <= 100", name='chk_benefit_statements_ownership_percentage'),
        {'quote': False}
    )

    credit_card_id = Column(Integer, ForeignKey('credit_cards.id'), nullable=False, name="credit_card_id")
    date = Column(DateTime, nullable=False, name="date")
    description = Column(Text, nullable=False, name="description")
    amount = Column(Numeric(10, 2), nullable=False, name="amount")
    payment_method = Column(String(50), nullable=True, name="payment_method")
    subtag_id = Column(Integer, ForeignKey('subtags.id'), nullable=True, name="subtag_id")
    ownership_percentage = Column(Numeric(5, 2), nullable=False, default=100.00, name="ownership_percentage")
    expense_sharing_id = Column(Integer, ForeignKey('expense_sharing_settings.id'), nullable=True, name="expense_sharing_id")
    adjustment_notes = Column(Text, nullable=True, name="adjustment_notes")
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True, name="account_id")

    # Relacionamentos
    credit_card = relationship("Cartao", back_populates="benefit_statements")
    subtag = relationship("Subtag")
    expense_sharing = relationship("ExpenseSharingSetting", back_populates="benefit_card_statements")
    account = relationship("Account")

    @property
    def adjustment_type(self) -> str:
        """Deriva o adjustment_type baseado no ownership_percentage da configuração de compartilhamento."""
        if self.expense_sharing_id is not None and self.expense_sharing:
            if self.expense_sharing.my_contribution_percentage == 0:
                return 'terceiro'
            elif 0 < self.expense_sharing.my_contribution_percentage < 100:
                return 'compartilhado'
        return 'proprio'


class TransactionMapping(Base, AccountBaseEntity):
    """
    Modelo para mapeamento de transações.

    Armazena o mapeamento entre descrições originais de transações (despesas e receitas) e suas
    categorias (subtags). Permite categorização automática de transações
    baseada em descrições conhecidas.

    Mapeamentos são específicos por conta (account_id).
    Configurações específicas por conta.

    Tipos de mapeamento (todas as buscas são case-insensitive):
    - 'exact': Correspondência exata da descrição completa (padrão)
    - 'pattern': Busca se o padrão está contido na descrição
    - 'regex': Correspondência usando expressão regular
    """
    __tablename__ = 'transaction_mappings'
    __table_args__ = {'quote': False}

    # 1. Campos de negócio
    original_description = Column(String(255), nullable=False, name="original_description")
    mapped_description = Column(String(255), nullable=True, name="mapped_description")
    subtag_id = Column(Integer, ForeignKey('subtags.id', ondelete='CASCADE'), nullable=False, name="subtag_id", index=True)
    expense_sharing_id = Column(Integer, ForeignKey('expense_sharing_settings.id'), nullable=True, name="expense_sharing_id")
    my_contribution_percentage = Column(Numeric(5, 2), nullable=True, name="my_contribution_percentage")
    mapping_type = Column(String(20), nullable=False, default='exact', name="mapping_type")
    pattern = Column(String(255), nullable=True, name="pattern")
    regex_pattern = Column(String(255), nullable=True, name="regex_pattern")
    priority = Column(Integer, nullable=False, default=0, name="priority")
    is_sensitive = Column(Boolean, nullable=False, default=False, name="is_sensitive")

    # 2. Campos do AccountBaseEntity (herdados: id, account_id, tenant_id, created_by, created_at, last_updated_at)

    # 3. SEM active (hard delete)

    # Relacionamentos
    account = relationship("Account", back_populates="transaction_mappings")
    subtag = relationship("Subtag")
    expense_sharing = relationship("ExpenseSharingSetting", back_populates="transaction_mappings")


class BalanceClosure(Base, BaseEntity):
    """
    Histórico de fechamentos de balanço compartilhado.
    Armazena snapshot do cabeçalho com totais e informações gerais.
    """
    __tablename__ = 'balance_closures'
    __table_args__ = {'quote': False}

    # Identificação (para filtros/queries - sem FK)
    expense_sharing_id = Column(Integer, nullable=False, index=True, name="expense_sharing_id")
    account_id = Column(Integer, nullable=False, name="account_id")
    shared_account_id = Column(Integer, nullable=False, name="shared_account_id")

    # Período
    period_start_date = Column(TIMESTAMP, nullable=False, name="period_start_date")
    closing_date = Column(TIMESTAMP, nullable=False, index=True, name="closing_date")
    year = Column(Integer, nullable=False, index=True, name="year")
    month = Column(Integer, nullable=False, index=True, name="month")

    # Totais (sempre positivos ou zero)
    total_to_receive = Column(Numeric(15, 2), nullable=False, name="total_to_receive")
    total_to_pay = Column(Numeric(15, 2), nullable=False, name="total_to_pay")
    net_balance = Column(Numeric(15, 2), nullable=False, name="net_balance")  # Negativo = a receber, Positivo = a pagar

    # Metadados
    notes = Column(Text, nullable=True, name="notes")

    # Quitação
    is_settled = Column(Boolean, nullable=False, default=False, index=True, name="is_settled")
    settled_at = Column(TIMESTAMP, nullable=True, name="settled_at")
    settled_by = Column(Integer, ForeignKey('users.id'), nullable=True, name="settled_by")
    settlement_notes = Column(Text, nullable=True, name="settlement_notes")

    # SNAPSHOT DO CABEÇALHO (JSON)
    closure_data = Column(JSONB, nullable=False, name="closure_data")

    # Relacionamentos
    settler = relationship("Usuario", foreign_keys=[settled_by])
    closure_payments = relationship("BalanceClosurePayment", back_populates="balance_closure", cascade="all, delete-orphan")


class BalanceClosurePayment(Base, AccountBaseEntity):
    """
    Pagamentos parciais de fechamentos de balanço compartilhado.

    Cada pagamento deduz do saldo devedor do fechamento.
    Saldo restante = abs(net_balance) - SUM(balance_closure_payments.amount)
    """
    __tablename__ = 'balance_closure_payments'
    __table_args__ = (
        CheckConstraint("amount > 0", name='chk_balance_closure_payments_amount_positive'),
        {'quote': False}
    )

    # Vínculo com o fechamento
    balance_closure_id = Column(Integer, ForeignKey('balance_closures.id', ondelete='CASCADE'), nullable=False, index=True, name="balance_closure_id")

    # Valor e data
    amount = Column(Numeric(15, 2), nullable=False, name="amount")
    payment_date = Column(TIMESTAMP, nullable=False, name="payment_date")

    # Observações
    notes = Column(Text, nullable=True, name="notes")

    # Lançamento gerado automaticamente no extrato (bank_statement_id = NULL se não gerado)
    bank_statement_id = Column(Integer, ForeignKey('bank_statements.id', ondelete='SET NULL'), nullable=True, name="bank_statement_id", index=True)

    # Soft delete
    active = Column(Boolean, nullable=False, default=True, name="active")

    # Relacionamentos
    balance_closure = relationship("BalanceClosure", back_populates="closure_payments")
    account = relationship("Account", foreign_keys="[BalanceClosurePayment.account_id]")
    bank_statement = relationship("BankStatement", foreign_keys="[BalanceClosurePayment.bank_statement_id]")


class ExpenseTemplate(Base, AccountBaseEntity):
    """
    Modelo para templates de lançamentos.

    Permite criar templates reutilizáveis com múltiplas despesas/receitas pré-configuradas.
    Facilita lançamentos recorrentes (ex: "Contas Fixas Mensais", "Compras do Mês").
    Configurações específicas por conta.
    """
    __tablename__ = 'expense_templates'
    __table_args__ = {'quote': False}

    # 1. Campos de negócio
    name = Column(String(100), nullable=False, name="name")
    description = Column(Text, nullable=True, name="description")
    icon = Column(String(50), nullable=True, default='FileText', name="icon")

    # 2. Campos do AccountBaseEntity (herdados: id, account_id, tenant_id, created_by, created_at, last_updated_at)

    # 3. Active (soft delete)
    active = Column(Boolean, nullable=False, default=True, name="active")

    # Relacionamentos
    account = relationship("Account", foreign_keys="[ExpenseTemplate.account_id]")
    items = relationship("ExpenseTemplateItem", back_populates="template", cascade="all, delete-orphan")


class ExpenseTemplateItem(Base, AccountBaseEntity):
    """
    Modelo para itens de templates de lançamentos.

    Cada item representa uma despesa/receita pré-configurada dentro de um template.
    Ao usar o template, os itens são convertidos em bank_statements.
    Configurações específicas por conta.
    """
    __tablename__ = 'expense_template_items'
    __table_args__ = (
        CheckConstraint("day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)", name='chk_template_items_day_of_month'),
        CheckConstraint("ownership_percentage >= 0 AND ownership_percentage <= 100", name='chk_template_items_ownership_percentage'),
        {'quote': False}
    )

    # 1. Campos de negócio
    expense_template_id = Column(Integer, ForeignKey('expense_templates.id', ondelete='CASCADE'), nullable=False, name="expense_template_id", index=True)
    description = Column(Text, nullable=False, name="description")
    amount = Column(Numeric(10, 2), nullable=True, name="amount")  # Nullable: usuário pode definir na hora
    day_of_month = Column(Integer, nullable=True, name="day_of_month")  # 1-31, combina com mês/ano atual
    subtag_id = Column(Integer, ForeignKey('subtags.id', ondelete='RESTRICT'), nullable=True, name="subtag_id", index=True)  # Nullable: opcional
    ownership_percentage = Column(Numeric(5, 2), nullable=False, default=100.00, name="ownership_percentage")
    expense_sharing_id = Column(Integer, ForeignKey('expense_sharing_settings.id', ondelete='RESTRICT'), nullable=True, name="expense_sharing_id")
    display_order = Column(Integer, nullable=False, default=0, name="display_order")

    # 2. Campos do AccountBaseEntity (herdados: id, account_id, tenant_id, created_by, created_at, last_updated_at)

    # 3. SEM active (hard delete)

    # Relacionamentos
    account = relationship("Account", foreign_keys="[ExpenseTemplateItem.account_id]")
    template = relationship("ExpenseTemplate", back_populates="items")
    subtag = relationship("Subtag")
    expense_sharing = relationship("ExpenseSharingSetting")


class Loan(Base, AccountBaseEntity):
    """
    Modelo para empréstimos entre contas ou para entidades externas.

    Suporta:
    - Empréstimos para contas do sistema (counterpart_account_id)
    - Empréstimos para entidades externas (external_name)
    - Juros opcionais (simples ou compostos)
    - Liquidações parciais via loan_payments

    loan_type na perspectiva do criador:
    - 'lent': Eu emprestei (tenho a receber)
    - 'borrowed': Eu peguei emprestado (tenho a pagar)
    """
    __tablename__ = 'loans'
    __table_args__ = (
        CheckConstraint("loan_type IN ('lent', 'borrowed')", name='chk_loans_loan_type'),
        CheckConstraint("status IN ('open', 'settled')", name='chk_loans_status'),
        CheckConstraint("principal_amount > 0", name='chk_loans_principal_positive'),
        CheckConstraint(
            "(counterpart_account_id IS NOT NULL AND external_name IS NULL) OR "
            "(counterpart_account_id IS NULL AND external_name IS NOT NULL)",
            name='chk_loans_counterpart_or_external'
        ),
        CheckConstraint(
            "(interest_enabled = FALSE) OR "
            "(interest_enabled = TRUE AND interest_type IS NOT NULL AND interest_rate IS NOT NULL AND interest_period IS NOT NULL)",
            name='chk_loans_interest_config'
        ),
        {'quote': False}
    )

    # 1. Campos de negócio - Tipo e valores
    loan_type = Column(String(20), nullable=False, name="loan_type")
    principal_amount = Column(Numeric(15, 2), nullable=False, name="principal_amount")
    description = Column(Text, nullable=False, name="description")
    loan_date = Column(TIMESTAMP, nullable=False, name="loan_date")
    due_date = Column(TIMESTAMP, nullable=True, name="due_date")

    # 2. Juros (opcionais)
    interest_enabled = Column(Boolean, nullable=False, default=False, name="interest_enabled")
    interest_type = Column(String(20), nullable=True, name="interest_type")  # 'simple' ou 'compound'
    interest_rate = Column(Numeric(8, 4), nullable=True, name="interest_rate")  # Taxa em %
    interest_period = Column(String(20), nullable=True, name="interest_period")  # 'daily', 'monthly', 'yearly'

    # 3. Contraparte (conta do sistema OU externa)
    counterpart_account_id = Column(Integer, ForeignKey('accounts.id', ondelete='RESTRICT'), nullable=True, name="counterpart_account_id", index=True)
    external_name = Column(String(255), nullable=True, name="external_name")
    external_description = Column(Text, nullable=True, name="external_description")

    # 4. Status
    status = Column(String(20), nullable=False, default='open', name="status")
    settled_at = Column(TIMESTAMP, nullable=True, name="settled_at")
    last_reopened_at = Column(TIMESTAMP, nullable=True, name="last_reopened_at")
    reopened_count = Column(Integer, nullable=False, default=0, name="reopened_count")

    # 5. Origem (se criado a partir de despesa/receita)
    # source_table: nome real da tabela de origem (NULL = manual)
    source_table = Column(String(50), nullable=True, name="source_table")  # 'bank_statements', 'credit_card_invoices', 'benefit_card_statements'
    source_id = Column(Integer, nullable=True, name="source_id")

    # 6. Active
    active = Column(Boolean, nullable=False, default=True, name="active")

    # Relacionamentos
    account = relationship("Account", foreign_keys="[Loan.account_id]")
    counterpart_account = relationship("Account", foreign_keys=[counterpart_account_id])
    payments = relationship("LoanPayment", back_populates="loan", cascade="all, delete-orphan")


class LoanPayment(Base, AccountBaseEntity):
    """
    Modelo para liquidações/pagamentos de empréstimos.

    Cada pagamento deduz do saldo devedor do empréstimo.
    Saldo = principal_amount - SUM(loan_payments.amount)

    Origem:
    - source_table = NULL: Pagamento manual
    - source_table = nome da tabela: Vinculado a um item importado
    """
    __tablename__ = 'loan_payments'
    __table_args__ = (
        CheckConstraint("amount > 0", name='chk_loan_payments_amount_positive'),
        {'quote': False}
    )

    # 1. Campos de negócio
    loan_id = Column(Integer, ForeignKey('loans.id', ondelete='CASCADE'), nullable=False, name="loan_id", index=True)
    amount = Column(Numeric(15, 2), nullable=False, name="amount")
    payment_date = Column(TIMESTAMP, nullable=False, name="payment_date")

    # 2. Origem (NULL = manual, preenchido = vinculado a item importado)
    source_table = Column(String(50), nullable=True, name="source_table")  # 'bank_statements', 'credit_card_invoices', 'benefit_card_statements'
    source_id = Column(Integer, nullable=True, name="source_id")

    # 3. Vínculo com fechamento de balanço (NULL = avulso, preenchido = gerado via fechamento)
    balance_closure_id = Column(Integer, ForeignKey('balance_closures.id', ondelete='SET NULL'), nullable=True, name="balance_closure_id", index=True)

    # 4. Notas
    notes = Column(Text, nullable=True, name="notes")

    # 5. Active
    active = Column(Boolean, nullable=False, default=True, name="active")

    # Relacionamentos
    account = relationship("Account", foreign_keys="[LoanPayment.account_id]")
    loan = relationship("Loan", back_populates="payments")
    balance_closure = relationship("BalanceClosure", foreign_keys=[balance_closure_id])


# Alias para compatibilidade com código existente
ExpenseMapping = TransactionMapping
