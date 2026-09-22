"""
Modelos para importacao de Holerites (ADP) e Informes de Rendimentos.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Numeric,
    Date,
    DateTime,
    ForeignKey,
    Boolean,
)
from sqlalchemy.orm import relationship

from app.models.base import Base
from app.models.base_entity import AccountBaseEntity


class PayrollLineType(Base, AccountBaseEntity):
    __tablename__ = "payroll_line_types"
    __table_args__ = {"quote": False}

    doc_type = Column(String(30), nullable=False, name="doc_type")
    code = Column(String(20), nullable=True, name="code")
    description_normalized = Column(Text, nullable=False, name="description_normalized")
    display_name = Column(Text, nullable=False, name="display_name")
    active = Column(Boolean, nullable=False, default=True, name="active")

    payslip_lines = relationship("PayslipLine", back_populates="line_type")
    income_report_lines = relationship("IncomeReportLine", back_populates="line_type")


class Payslip(Base, AccountBaseEntity):
    __tablename__ = "payslips"
    __table_args__ = {"quote": False}

    source_provider = Column(String(50), nullable=False, default="adp", name="source_provider")
    employee_registration = Column(String(50), nullable=True, name="employee_registration")
    employee_name = Column(String(255), nullable=True, name="employee_name")
    employee_role = Column(String(120), nullable=True, name="employee_role")
    employer_cnpj = Column(String(20), nullable=True, name="employer_cnpj")
    employer_name = Column(String(255), nullable=True, name="employer_name")
    reference_label = Column(String(50), nullable=True, name="reference_label")
    payslip_kind = Column(String(20), nullable=False, default="regular", name="payslip_kind")
    year = Column(Integer, nullable=True, name="year")
    month = Column(Integer, nullable=True, name="month")
    payment_date = Column(Date, nullable=True, name="payment_date")
    gross_earnings = Column(Numeric(14, 2), nullable=True, name="gross_earnings")
    total_deductions = Column(Numeric(14, 2), nullable=True, name="total_deductions")
    net_amount = Column(Numeric(14, 2), nullable=True, name="net_amount")
    active = Column(Boolean, nullable=False, default=True, name="active")

    lines = relationship(
        "PayslipLine",
        back_populates="payslip",
        cascade="all, delete-orphan",
    )


class PayslipLine(Base, AccountBaseEntity):
    __tablename__ = "payslip_lines"
    __table_args__ = {"quote": False}

    payslip_id = Column(Integer, ForeignKey("payslips.id", ondelete="CASCADE"), nullable=False, name="payslip_id")
    line_type_id = Column(Integer, ForeignKey("payroll_line_types.id", ondelete="RESTRICT"), nullable=True, name="line_type_id")
    section = Column(String(30), nullable=False, name="section")
    line_code = Column(String(20), nullable=True, name="line_code")
    description = Column(Text, nullable=False, name="description")
    quantity = Column(Numeric(12, 2), nullable=True, name="quantity")
    earnings_amount = Column(Numeric(14, 2), nullable=True, name="earnings_amount")
    deduction_amount = Column(Numeric(14, 2), nullable=True, name="deduction_amount")
    base_amount = Column(Numeric(14, 2), nullable=True, name="base_amount")
    active = Column(Boolean, nullable=False, default=True, name="active")

    payslip = relationship("Payslip", back_populates="lines")
    line_type = relationship("PayrollLineType", back_populates="payslip_lines")


class IncomeReport(Base, AccountBaseEntity):
    __tablename__ = "income_reports"
    __table_args__ = {"quote": False}

    report_year = Column(Integer, nullable=True, name="report_year")
    calendar_year = Column(Integer, nullable=True, name="calendar_year")
    payer_cnpj = Column(String(20), nullable=True, name="payer_cnpj")
    payer_name = Column(String(255), nullable=True, name="payer_name")
    beneficiary_cpf = Column(String(20), nullable=True, name="beneficiary_cpf")
    beneficiary_name = Column(String(255), nullable=True, name="beneficiary_name")
    nature_code = Column(String(30), nullable=True, name="nature_code")
    nature_description = Column(String(255), nullable=True, name="nature_description")
    issued_at = Column(DateTime, nullable=True, name="issued_at")
    active = Column(Boolean, nullable=False, default=True, name="active")

    lines = relationship(
        "IncomeReportLine",
        back_populates="income_report",
        cascade="all, delete-orphan",
    )


class IncomeReportLine(Base, AccountBaseEntity):
    __tablename__ = "income_report_lines"
    __table_args__ = {"quote": False}

    income_report_id = Column(
        Integer,
        ForeignKey("income_reports.id", ondelete="CASCADE"),
        nullable=False,
        name="income_report_id",
    )
    line_type_id = Column(Integer, ForeignKey("payroll_line_types.id", ondelete="RESTRICT"), nullable=True, name="line_type_id")
    group_name = Column(String(120), nullable=False, name="group_name")
    item_no = Column(String(20), nullable=True, name="item_no")
    description = Column(Text, nullable=False, name="description")
    amount = Column(Numeric(14, 2), nullable=True, name="amount")
    active = Column(Boolean, nullable=False, default=True, name="active")

    income_report = relationship("IncomeReport", back_populates="lines")
    line_type = relationship("PayrollLineType", back_populates="income_report_lines")
