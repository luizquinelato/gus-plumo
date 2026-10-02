# -*- coding: utf-8 -*-
import json
import os
import re
import shutil
import tempfile
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_account
from app.models.base_entity import now_utc
from app.models.payroll_models import IncomeReport, IncomeReportLine, PayrollLineType, Payslip, PayslipLine
from app.utils.account_import_password import (
    account_default_import_file_password,
    load_account_for_user,
)
from app.utils.pdf_password import (
    PdfPasswordInvalid,
    PdfPasswordRequired,
    resolve_pdf_password_at_index,
)

from app.services.payroll_pdf_service import (
    ADVANCE_LINE_CODE,
    FINAL_ADVANCE_DEDUCTION_LINE_CODE,
    classify_payroll_pdf,
    detect_payslip_format,
    detect_payslip_kind,
    extract_pdf_text,
    is_account_section,
    is_advance_transfer_line,
    normalize_line_description,
    parse_income_report_text,
    parse_payslip_text,
    payslip_kind_family,
)

router = APIRouter(prefix="/api/payroll", tags=["payroll"])


def _account_default_pdf_password(db: Session, current_user: dict) -> Optional[str]:
    tenant_id = current_user.get("tenant_id")
    account_id = current_user.get("account_id")
    account = load_account_for_user(db, tenant_id, account_id)
    return account_default_import_file_password(account)


class ImportFileResult(BaseModel):
    filename: str
    status: str
    doc_type: Optional[str] = None
    message: Optional[str] = None
    record_id: Optional[int] = None
    action: Optional[str] = None  # created | updated
    employee_name: Optional[str] = None
    employer_name: Optional[str] = None
    payer_name: Optional[str] = None
    beneficiary_name: Optional[str] = None
    reference_label: Optional[str] = None
    payslip_kind: Optional[str] = None
    source_provider: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    calendar_year: Optional[int] = None
    report_year: Optional[int] = None
    net_amount: Optional[Decimal] = None
    gross_earnings: Optional[Decimal] = None
    total_deductions: Optional[Decimal] = None


class ClassifyFileResult(BaseModel):
    filename: str
    status: str
    doc_type: Optional[str] = None
    message: Optional[str] = None
    employee_name: Optional[str] = None
    employer_name: Optional[str] = None
    payer_name: Optional[str] = None
    beneficiary_name: Optional[str] = None
    reference_label: Optional[str] = None
    payslip_kind: Optional[str] = None
    source_provider: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    calendar_year: Optional[int] = None
    report_year: Optional[int] = None


class ClassifyPayrollResponse(BaseModel):
    results: List[ClassifyFileResult]


def _pdf_user_message(exc: Exception) -> str:
    if isinstance(exc, PdfPasswordRequired):
        return "PDF protegido por senha"
    if isinstance(exc, PdfPasswordInvalid):
        return "Senha do PDF incorreta"
    return str(exc)


class ImportPayrollResponse(BaseModel):
    success: bool
    imported_payslips: int
    imported_income_reports: int
    failures: int
    line_types_created_count: int
    line_types_created: List[str]
    results: List[ImportFileResult]


class PayrollFilterOptionsResponse(BaseModel):
    employers: List[str]
    years: List[int]
    payers: List[str]


class PayslipLineResponse(BaseModel):
    id: int
    section: str
    line_code: Optional[str] = None
    description: str
    quantity: Optional[Decimal] = None
    earnings_amount: Optional[Decimal] = None
    deduction_amount: Optional[Decimal] = None
    base_amount: Optional[Decimal] = None
    line_type_name: Optional[str] = None

    class Config:
        from_attributes = True


class PayslipPaymentResponse(BaseModel):
    kind: str
    payment_date: Optional[date] = None
    net_amount: Optional[Decimal] = None


class PayslipResponse(BaseModel):
    id: int
    employee_registration: Optional[str] = None
    employee_name: Optional[str] = None
    employee_role: Optional[str] = None
    employer_cnpj: Optional[str] = None
    employer_name: Optional[str] = None
    reference_label: Optional[str] = None
    payslip_kind: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    payment_date: Optional[date] = None
    gross_earnings: Optional[Decimal] = None
    total_deductions: Optional[Decimal] = None
    net_amount: Optional[Decimal] = None
    payments: List[PayslipPaymentResponse] = Field(default_factory=list)
    created_at: datetime

    class Config:
        from_attributes = True


def _normalize_tax_id(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    return digits or None


def _normalize_name(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = re.sub(r"\s+", " ", value.strip().upper())
    return normalized or None


def _find_existing_income_report(
    db: Session,
    *,
    tenant_id: int,
    account_id: int,
    calendar_year: Optional[int],
    beneficiary_cpf: Optional[str],
    beneficiary_name: Optional[str],
    payer_cnpj: Optional[str],
    payer_name: Optional[str],
) -> Optional[IncomeReport]:
    if calendar_year is None:
        return None

    target_cpf = _normalize_tax_id(beneficiary_cpf)
    target_cnpj = _normalize_tax_id(payer_cnpj)
    target_beneficiary = _normalize_name(beneficiary_name)
    target_payer = _normalize_name(payer_name)

    candidates = (
        db.query(IncomeReport)
        .filter(
            IncomeReport.tenant_id == tenant_id,
            IncomeReport.account_id == account_id,
            IncomeReport.calendar_year == calendar_year,
            IncomeReport.active == True,
        )
        .order_by(IncomeReport.id.desc())
        .all()
    )

    for report in candidates:
        report_cpf = _normalize_tax_id(report.beneficiary_cpf)
        report_cnpj = _normalize_tax_id(report.payer_cnpj)
        report_beneficiary = _normalize_name(report.beneficiary_name)
        report_payer = _normalize_name(report.payer_name)

        if target_cpf and report_cpf and target_cpf != report_cpf:
            continue
        if not target_cpf and target_beneficiary and report_beneficiary and target_beneficiary != report_beneficiary:
            continue

        if target_cnpj and report_cnpj:
            if target_cnpj == report_cnpj:
                return report
            continue

        if target_payer and report_payer and target_payer == report_payer:
            return report

    return None


def _replace_income_report_lines(
    db: Session,
    *,
    report: IncomeReport,
    tenant_id: int,
    account_id: int,
    user_id: int,
    line_items: List[dict],
    get_or_create_line_type,
) -> None:
    db.query(IncomeReportLine).filter(
        IncomeReportLine.income_report_id == report.id,
        IncomeReportLine.tenant_id == tenant_id,
        IncomeReportLine.account_id == account_id,
    ).delete(synchronize_session=False)

    for line in line_items:
        line_type = get_or_create_line_type(
            doc_type="income_report",
            code=line.get("item_no"),
            description=line.get("description") or "-",
        )
        db.add(
            IncomeReportLine(
                tenant_id=tenant_id,
                account_id=account_id,
                created_by=user_id,
                income_report_id=report.id,
                line_type_id=line_type.id,
                group_name=line.get("group_name") or "Geral",
                item_no=line.get("item_no"),
                description=line.get("description") or "-",
                amount=line.get("amount"),
            )
        )


def _find_existing_payslip(
    db: Session,
    *,
    tenant_id: int,
    account_id: int,
    year: Optional[int],
    month: Optional[int],
    payslip_kind: str,
) -> Optional[Payslip]:
    """Mesmo período + tipo = mesmo holerite (BR Oficial e ADP são formatos do mesmo doc)."""
    if year is None or month is None:
        return None
    matches = (
        db.query(Payslip)
        .filter(
            Payslip.tenant_id == tenant_id,
            Payslip.account_id == account_id,
            Payslip.year == year,
            Payslip.month == month,
            Payslip.payslip_kind == payslip_kind,
            Payslip.active == True,
        )
        .order_by(Payslip.id.desc())
        .all()
    )
    if not matches:
        return None
    primary = matches[0]
    # Remove duplicatas do mesmo período/tipo (ex.: importou BR Oficial e ADP).
    for duplicate in matches[1:]:
        _hard_delete_payslip_records(
            db,
            tenant_id=tenant_id,
            account_id=account_id,
            payslips=[duplicate],
        )
    return primary


def _replace_payslip_lines(
    db: Session,
    *,
    payslip: Payslip,
    tenant_id: int,
    account_id: int,
    user_id: int,
    line_items: List[dict],
    get_or_create_line_type,
) -> None:
    db.query(PayslipLine).filter(
        PayslipLine.payslip_id == payslip.id,
        PayslipLine.tenant_id == tenant_id,
        PayslipLine.account_id == account_id,
    ).delete(synchronize_session=False)

    for line in line_items:
        line_type = get_or_create_line_type(
            doc_type="payslip",
            code=line.get("line_code"),
            description=line.get("description") or "-",
        )
        db.add(
            PayslipLine(
                tenant_id=tenant_id,
                account_id=account_id,
                created_by=user_id,
                payslip_id=payslip.id,
                line_type_id=line_type.id,
                section=line.get("section") or "other",
                line_code=line.get("line_code"),
                description=line.get("description") or "-",
                quantity=line.get("quantity"),
                earnings_amount=line.get("earnings_amount"),
                deduction_amount=line.get("deduction_amount"),
                base_amount=line.get("base_amount"),
            )
        )


def _deactivate_advance_line_on_final_import(
    db: Session,
    *,
    tenant_id: int,
    account_id: int,
    year: Optional[int],
    month: Optional[int],
) -> None:
    if not year or not month:
        return

    advance_payslips = (
        db.query(Payslip)
        .filter(
            Payslip.tenant_id == tenant_id,
            Payslip.account_id == account_id,
            Payslip.year == year,
            Payslip.month == month,
            Payslip.payslip_kind == "advance",
            Payslip.active == True,
        )
        .all()
    )
    for advance in advance_payslips:
        db.query(PayslipLine).filter(
            PayslipLine.payslip_id == advance.id,
            PayslipLine.line_code == ADVANCE_LINE_CODE,
            PayslipLine.active == True,
        ).update({"active": False}, synchronize_session=False)


def _get_line_type_map(db: Session, tenant_id: int, account_id: int) -> dict[int, str]:
    return {
        lt.id: lt.display_name
        for lt in db.query(PayrollLineType).filter(
            PayrollLineType.tenant_id == tenant_id,
            PayrollLineType.account_id == account_id,
            PayrollLineType.active == True,
        )
    }


def _build_payslip_line_responses(lines: List[PayslipLine], line_type_map: dict[int, str]) -> List[PayslipLineResponse]:
    return [
        PayslipLineResponse.model_validate(x).model_copy(
            update={"line_type_name": line_type_map.get(x.line_type_id)}
        )
        for x in lines
    ]


def _as_decimal(value: Optional[Decimal]) -> Decimal:
    return value if value is not None else Decimal(0)


def _group_has_final(group: List[Payslip]) -> bool:
    return any(p.payslip_kind == "final" for p in group)


def _build_payments(group: List[Payslip]) -> List[PayslipPaymentResponse]:
    kind_order = {"advance": 0, "regular": 1, "final": 2, "profit_share": 3}
    ordered = sorted(
        group,
        key=lambda p: (
            p.payment_date or date.min,
            kind_order.get(p.payslip_kind or "", 9),
            p.id,
        ),
    )
    return [
        PayslipPaymentResponse(
            kind=p.payslip_kind or "regular",
            payment_date=p.payment_date,
            net_amount=p.net_amount,
        )
        for p in ordered
    ]


def _payments_with_line_fallback(
    group: List[Payslip],
    lines: List[PayslipLine],
) -> List[PayslipPaymentResponse]:
    payments = _build_payments(group)
    if any(p.kind == "advance" for p in payments):
        return payments
    transfer = sum(
        (_as_decimal(line.deduction_amount) for line in lines if _line_code(line) == FINAL_ADVANCE_DEDUCTION_LINE_CODE),
        Decimal(0),
    )
    if transfer > 0:
        payments.insert(
            0,
            PayslipPaymentResponse(kind="advance", payment_date=None, net_amount=transfer),
        )
    return payments


def _line_code(line: PayslipLine) -> str:
    return str(line.line_code or "").strip()


def _compute_totals_from_account_lines(
    lines: List[PayslipLine],
    *,
    has_final: bool = False,
) -> dict[str, Optional[Decimal]]:
    account_lines = [
        line
        for line in lines
        if is_account_section(line.section) and not is_advance_transfer_line(line, has_final=has_final)
    ]
    earnings = sum((_as_decimal(line.earnings_amount) for line in account_lines), Decimal(0))
    deductions = sum((_as_decimal(line.deduction_amount) for line in account_lines), Decimal(0))
    if not earnings and not deductions:
        return {"gross_earnings": None, "total_deductions": None, "net_amount": None}
    return {
        "gross_earnings": earnings,
        "total_deductions": deductions,
        "net_amount": earnings - deductions,
    }


def _month_totals_from_group(group: List[Payslip]) -> tuple[Optional[Decimal], Optional[Decimal], Optional[Decimal]]:
    payments = _build_payments(group)
    has_paid = any(p.net_amount is not None for p in payments)
    paid = sum((_as_decimal(p.net_amount) for p in payments), Decimal(0)) if has_paid else None
    final = next((p for p in group if p.payslip_kind == "final"), None)
    regular = next((p for p in group if p.payslip_kind == "regular"), None)
    advance = next((p for p in group if p.payslip_kind == "advance"), None)
    sheet = final or regular
    if sheet is not None and sheet.gross_earnings is not None and paid is not None:
        return sheet.gross_earnings, sheet.gross_earnings - paid, paid
    if sheet is not None:
        raw_ded = sheet.total_deductions
        if raw_ded is not None and advance is not None and final is not None:
            raw_ded = raw_ded - _as_decimal(advance.net_amount)
        return sheet.gross_earnings, raw_ded, paid if paid is not None else sheet.net_amount
    primary = advance or group[0]
    return primary.gross_earnings, primary.total_deductions, paid if paid is not None else primary.net_amount


def _consolidate_payslip_group(group: List[Payslip]) -> PayslipResponse:
    final = next((p for p in group if p.payslip_kind == "final"), None)
    primary = final or sorted(group, key=lambda p: p.id, reverse=True)[0]
    reference_label = primary.reference_label
    if not reference_label and primary.year and primary.month:
        reference_label = f"{primary.month:02d}/{primary.year}"

    employee_source = final or primary
    family = payslip_kind_family(primary.payslip_kind)
    if family == "profit_share":
        kind = "profit_share"
    elif len(group) > 1:
        kind = "consolidated"
    else:
        kind = primary.payslip_kind

    gross, deductions, net = _month_totals_from_group(group)
    payments = _build_payments(group)

    return PayslipResponse(
        id=primary.id,
        employee_registration=employee_source.employee_registration,
        employee_name=employee_source.employee_name,
        employee_role=employee_source.employee_role,
        employer_cnpj=primary.employer_cnpj,
        employer_name=primary.employer_name,
        reference_label=reference_label,
        payslip_kind=kind,
        year=primary.year,
        month=primary.month,
        payment_date=primary.payment_date,
        gross_earnings=gross,
        total_deductions=deductions,
        net_amount=net,
        payments=payments,
        created_at=max(p.created_at for p in group),
    )


def _fetch_period_payslips(
    db: Session,
    *,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
    family: Optional[str] = None,
) -> List[Payslip]:
    query = db.query(Payslip).filter(
        Payslip.tenant_id == tenant_id,
        Payslip.account_id == account_id,
        Payslip.year == year,
        Payslip.month == month,
        Payslip.active == True,
    )
    rows = query.order_by(Payslip.id.asc()).all()
    if family in ("salary", "profit_share"):
        rows = [p for p in rows if payslip_kind_family(p.payslip_kind) == family]
    return rows


class PayslipDetailResponse(PayslipResponse):
    lines: List[PayslipLineResponse]


class IncomeReportLineResponse(BaseModel):
    id: int
    group_name: str
    item_no: Optional[str] = None
    description: str
    amount: Optional[Decimal] = None
    line_type_name: Optional[str] = None

    class Config:
        from_attributes = True


class IncomeReportResponse(BaseModel):
    id: int
    report_year: Optional[int] = None
    calendar_year: Optional[int] = None
    payer_cnpj: Optional[str] = None
    payer_name: Optional[str] = None
    beneficiary_cpf: Optional[str] = None
    beneficiary_name: Optional[str] = None
    nature_code: Optional[str] = None
    nature_description: Optional[str] = None
    issued_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class IncomeReportDetailResponse(IncomeReportResponse):
    lines: List[IncomeReportLineResponse]


@router.post("/classify-pdfs", response_model=ClassifyPayrollResponse)
async def classify_payroll_pdfs(
    files: List[UploadFile] = File(...),
    passwords: List[str] = Form([]),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo fornecido")

    default_password = _account_default_pdf_password(db, current_user)
    temp_dir = tempfile.mkdtemp()
    results: List[ClassifyFileResult] = []

    try:
        for index, file in enumerate(files):
            filename = file.filename or "arquivo.pdf"
            if not filename.lower().endswith(".pdf"):
                results.append(
                    ClassifyFileResult(
                        filename=filename,
                        status="error",
                        message="Arquivo não é PDF",
                    )
                )
                continue

            safe_name = os.path.basename(filename)
            temp_path = os.path.join(temp_dir, safe_name)
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            pdf_password = resolve_pdf_password_at_index(
                passwords, index, default_password
            )
            try:
                raw_text = extract_pdf_text(temp_path, pdf_password)
                doc_type = classify_payroll_pdf(raw_text)

                if doc_type == "payslip":
                    parsed = parse_payslip_text(raw_text, source_filename=filename)
                    line_items = parsed.get("line_items", [])
                    payslip_kind = detect_payslip_kind(line_items)
                    source_provider = parsed.get("source_provider") or detect_payslip_format(raw_text)
                    results.append(
                        ClassifyFileResult(
                            filename=filename,
                            status="ok",
                            doc_type="payslip",
                            employee_name=parsed.get("employee_name"),
                            employer_name=parsed.get("employer_name"),
                            reference_label=parsed.get("reference_label"),
                            payslip_kind=payslip_kind,
                            source_provider=source_provider,
                            year=parsed.get("year"),
                            month=parsed.get("month"),
                        )
                    )
                else:
                    parsed = parse_income_report_text(raw_text)
                    results.append(
                        ClassifyFileResult(
                            filename=filename,
                            status="ok",
                            doc_type="income_report",
                            payer_name=parsed.get("payer_name"),
                            beneficiary_name=parsed.get("beneficiary_name"),
                            calendar_year=parsed.get("calendar_year"),
                            report_year=parsed.get("report_year"),
                        )
                    )
            except (PdfPasswordRequired, PdfPasswordInvalid) as ex:
                results.append(
                    ClassifyFileResult(
                        filename=filename,
                        status="error",
                        message=_pdf_user_message(ex),
                    )
                )
            except Exception as ex:
                results.append(
                    ClassifyFileResult(
                        filename=filename,
                        status="error",
                        message=str(ex),
                    )
                )

        return ClassifyPayrollResponse(results=results)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/import-pdfs", response_model=ImportPayrollResponse)
async def import_payroll_pdfs(
    files: List[UploadFile] = File(...),
    doc_types: Optional[str] = Form(None),
    passwords: List[str] = Form([]),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo fornecido")

    tenant_id = current_user.get("tenant_id")
    account_id = current_user.get("account_id")
    user_id = current_user.get("user_id") or current_user.get("id")

    override_types: List[Optional[str]] = []
    if doc_types:
        try:
            parsed_overrides = json.loads(doc_types)
            if isinstance(parsed_overrides, list):
                override_types = [
                    item if item in ("payslip", "income_report") else None
                    for item in parsed_overrides
                ]
        except Exception:
            raise HTTPException(status_code=400, detail="doc_types inválido")

    default_password = _account_default_pdf_password(db, current_user)
    temp_dir = tempfile.mkdtemp()
    results: List[ImportFileResult] = []
    imported_payslips = 0
    imported_income_reports = 0
    failures = 0
    line_types_created: set[str] = set()

    def get_or_create_line_type(
        *,
        doc_type: str,
        code: Optional[str],
        description: str,
    ) -> PayrollLineType:
        normalized = normalize_line_description(description)
        clean_code = (code or "").strip() or None
        query = db.query(PayrollLineType).filter(
            PayrollLineType.tenant_id == tenant_id,
            PayrollLineType.account_id == account_id,
            PayrollLineType.doc_type == doc_type,
            PayrollLineType.description_normalized == normalized,
            PayrollLineType.active == True,
        )
        if clean_code is None:
            query = query.filter(PayrollLineType.code.is_(None))
        else:
            query = query.filter(PayrollLineType.code == clean_code)

        existing = query.first()
        if existing:
            return existing

        created = PayrollLineType(
            tenant_id=tenant_id,
            account_id=account_id,
            created_by=user_id,
            doc_type=doc_type,
            code=clean_code,
            description_normalized=normalized,
            display_name=description.strip() or normalized,
        )
        db.add(created)
        db.flush()
        line_types_created.add(f"{doc_type}:{created.display_name}")
        return created

    try:
        for index, file in enumerate(files):
            filename = file.filename or "arquivo.pdf"
            if not filename.lower().endswith(".pdf"):
                failures += 1
                results.append(
                    ImportFileResult(filename=filename, status="error", message="Arquivo não é PDF")
                )
                continue

            safe_name = os.path.basename(filename)
            temp_path = os.path.join(temp_dir, f"{index}_{safe_name}")
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            pdf_password = resolve_pdf_password_at_index(
                passwords, index, default_password
            )
            try:
                raw_text = extract_pdf_text(temp_path, pdf_password)
                forced_type = override_types[index] if index < len(override_types) else None
                doc_type = forced_type or classify_payroll_pdf(raw_text)

                if doc_type == "payslip":
                    parsed = parse_payslip_text(raw_text, source_filename=filename)
                    line_items = parsed.get("line_items", [])
                    payslip_kind = detect_payslip_kind(line_items)
                    source_provider = parsed.get("source_provider") or detect_payslip_format(raw_text)
                    existing_payslip = _find_existing_payslip(
                        db,
                        tenant_id=tenant_id,
                        account_id=account_id,
                        year=parsed.get("year"),
                        month=parsed.get("month"),
                        payslip_kind=payslip_kind,
                    )
                    action = "updated" if existing_payslip else "created"
                    if existing_payslip:
                        existing_payslip.source_provider = source_provider
                        existing_payslip.employee_registration = parsed.get("employee_registration")
                        existing_payslip.employee_name = parsed.get("employee_name")
                        existing_payslip.employee_role = parsed.get("employee_role")
                        existing_payslip.employer_cnpj = parsed.get("employer_cnpj")
                        existing_payslip.employer_name = parsed.get("employer_name")
                        existing_payslip.reference_label = parsed.get("reference_label")
                        existing_payslip.payslip_kind = payslip_kind
                        existing_payslip.year = parsed.get("year")
                        existing_payslip.month = parsed.get("month")
                        existing_payslip.payment_date = parsed.get("payment_date")
                        existing_payslip.gross_earnings = parsed.get("gross_earnings")
                        existing_payslip.total_deductions = parsed.get("total_deductions")
                        existing_payslip.net_amount = parsed.get("net_amount")
                        existing_payslip.last_updated_at = now_utc()
                        payslip = existing_payslip
                    else:
                        payslip = Payslip(
                            tenant_id=tenant_id,
                            account_id=account_id,
                            created_by=user_id,
                            source_provider=source_provider,
                            employee_registration=parsed.get("employee_registration"),
                            employee_name=parsed.get("employee_name"),
                            employee_role=parsed.get("employee_role"),
                            employer_cnpj=parsed.get("employer_cnpj"),
                            employer_name=parsed.get("employer_name"),
                            reference_label=parsed.get("reference_label"),
                            payslip_kind=payslip_kind,
                            year=parsed.get("year"),
                            month=parsed.get("month"),
                            payment_date=parsed.get("payment_date"),
                            gross_earnings=parsed.get("gross_earnings"),
                            total_deductions=parsed.get("total_deductions"),
                            net_amount=parsed.get("net_amount"),
                        )
                        db.add(payslip)
                        db.flush()

                    _replace_payslip_lines(
                        db,
                        payslip=payslip,
                        tenant_id=tenant_id,
                        account_id=account_id,
                        user_id=user_id,
                        line_items=line_items,
                        get_or_create_line_type=get_or_create_line_type,
                    )

                    if payslip_kind == "final":
                        _deactivate_advance_line_on_final_import(
                            db,
                            tenant_id=tenant_id,
                            account_id=account_id,
                            year=parsed.get("year"),
                            month=parsed.get("month"),
                        )

                    imported_payslips += 1
                    results.append(
                        ImportFileResult(
                            filename=filename,
                            status="ok",
                            doc_type="payslip",
                            record_id=payslip.id,
                            action=action,
                            employee_name=parsed.get("employee_name"),
                            employer_name=parsed.get("employer_name"),
                            reference_label=parsed.get("reference_label"),
                            payslip_kind=payslip_kind,
                            source_provider=source_provider,
                            year=parsed.get("year"),
                            month=parsed.get("month"),
                            net_amount=parsed.get("net_amount"),
                            gross_earnings=parsed.get("gross_earnings"),
                            total_deductions=parsed.get("total_deductions"),
                        )
                    )

                else:
                    parsed = parse_income_report_text(raw_text)
                    existing_report = _find_existing_income_report(
                        db,
                        tenant_id=tenant_id,
                        account_id=account_id,
                        calendar_year=parsed.get("calendar_year"),
                        beneficiary_cpf=parsed.get("beneficiary_cpf"),
                        beneficiary_name=parsed.get("beneficiary_name"),
                        payer_cnpj=parsed.get("payer_cnpj"),
                        payer_name=parsed.get("payer_name"),
                    )

                    action = "updated" if existing_report else "created"
                    if existing_report:
                        existing_report.report_year = parsed.get("report_year")
                        existing_report.payer_cnpj = parsed.get("payer_cnpj")
                        existing_report.payer_name = parsed.get("payer_name")
                        existing_report.beneficiary_cpf = parsed.get("beneficiary_cpf")
                        existing_report.beneficiary_name = parsed.get("beneficiary_name")
                        existing_report.nature_code = parsed.get("nature_code")
                        existing_report.nature_description = parsed.get("nature_description")
                        existing_report.issued_at = parsed.get("issued_at")
                        existing_report.last_updated_at = now_utc()
                        report = existing_report
                    else:
                        report = IncomeReport(
                            tenant_id=tenant_id,
                            account_id=account_id,
                            created_by=user_id,
                            report_year=parsed.get("report_year"),
                            calendar_year=parsed.get("calendar_year"),
                            payer_cnpj=parsed.get("payer_cnpj"),
                            payer_name=parsed.get("payer_name"),
                            beneficiary_cpf=parsed.get("beneficiary_cpf"),
                            beneficiary_name=parsed.get("beneficiary_name"),
                            nature_code=parsed.get("nature_code"),
                            nature_description=parsed.get("nature_description"),
                            issued_at=parsed.get("issued_at"),
                        )
                        db.add(report)
                        db.flush()

                    _replace_income_report_lines(
                        db,
                        report=report,
                        tenant_id=tenant_id,
                        account_id=account_id,
                        user_id=user_id,
                        line_items=parsed.get("line_items", []),
                        get_or_create_line_type=get_or_create_line_type,
                    )

                    imported_income_reports += 1
                    results.append(
                        ImportFileResult(
                            filename=filename,
                            status="ok",
                            doc_type="income_report",
                            record_id=report.id,
                            action=action,
                            payer_name=parsed.get("payer_name"),
                            beneficiary_name=parsed.get("beneficiary_name"),
                            calendar_year=parsed.get("calendar_year"),
                            report_year=parsed.get("report_year"),
                        )
                    )

                db.commit()
            except Exception as ex:
                db.rollback()
                failures += 1
                results.append(
                    ImportFileResult(
                        filename=filename,
                        status="error",
                        message=str(ex),
                    )
                )

        return ImportPayrollResponse(
            success=failures == 0,
            imported_payslips=imported_payslips,
            imported_income_reports=imported_income_reports,
            failures=failures,
            line_types_created_count=len(line_types_created),
            line_types_created=sorted(list(line_types_created)),
            results=results,
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.get("/filter-options", response_model=PayrollFilterOptionsResponse)
async def get_filter_options(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id = current_user["tenant_id"]
    account_id = current_user["account_id"]
    base_filter = (
        Payslip.tenant_id == tenant_id,
        Payslip.account_id == account_id,
        Payslip.active == True,
    )
    employers = [
        row[0]
        for row in (
            db.query(Payslip.employer_name)
            .filter(*base_filter, Payslip.employer_name.isnot(None), Payslip.employer_name != "")
            .distinct()
            .order_by(Payslip.employer_name.asc())
            .all()
        )
    ]
    years = [
        row[0]
        for row in (
            db.query(Payslip.year)
            .filter(*base_filter, Payslip.year.isnot(None))
            .distinct()
            .order_by(Payslip.year.desc())
            .all()
        )
    ]
    payers = [
        row[0]
        for row in (
            db.query(IncomeReport.payer_name)
            .filter(
                IncomeReport.tenant_id == tenant_id,
                IncomeReport.account_id == account_id,
                IncomeReport.active == True,
                IncomeReport.payer_name.isnot(None),
                IncomeReport.payer_name != "",
            )
            .distinct()
            .order_by(IncomeReport.payer_name.asc())
            .all()
        )
    ]
    report_years = [
        row[0]
        for row in (
            db.query(IncomeReport.report_year)
            .filter(
                IncomeReport.tenant_id == tenant_id,
                IncomeReport.account_id == account_id,
                IncomeReport.active == True,
                IncomeReport.report_year.isnot(None),
            )
            .distinct()
            .order_by(IncomeReport.report_year.desc())
            .all()
        )
    ]
    merged_years = sorted(set(years) | set(report_years), reverse=True)
    return PayrollFilterOptionsResponse(employers=employers, years=merged_years, payers=payers)


@router.get("/payslips", response_model=List[PayslipResponse])
async def list_payslips(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    employer_name: Optional[str] = Query(None),
    employee_cpf: Optional[str] = Query(None),  # reservado para evolução
    consolidate: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    query = db.query(Payslip).filter(
        Payslip.tenant_id == current_user["tenant_id"],
        Payslip.account_id == current_user["account_id"],
        Payslip.active == True,
    )
    if year:
        query = query.filter(Payslip.year == year)
    if month:
        query = query.filter(Payslip.month == month)
    if employer_name:
        query = query.filter(Payslip.employer_name == employer_name)
    _ = employee_cpf
    payslips = query.order_by(Payslip.year.desc().nullslast(), Payslip.month.desc().nullslast(), Payslip.id.desc()).all()

    def _sort_key(item: PayslipResponse) -> tuple:
        return (
            item.year or 0,
            item.month or 0,
            1 if payslip_kind_family(item.payslip_kind) == "profit_share" else 0,
            item.id,
        )

    if not consolidate:
        items = [_consolidate_payslip_group([payslip]) for payslip in payslips]
        items.sort(key=_sort_key, reverse=True)
        return items

    grouped: dict[tuple[int, int, str], List[Payslip]] = {}
    ungrouped: List[Payslip] = []
    for payslip in payslips:
        if payslip.year is None or payslip.month is None:
            ungrouped.append(payslip)
            continue
        family = payslip_kind_family(payslip.payslip_kind)
        key = (payslip.year, payslip.month, family)
        grouped.setdefault(key, []).append(payslip)

    consolidated = [_consolidate_payslip_group(group) for group in grouped.values()]
    consolidated.extend(_consolidate_payslip_group([payslip]) for payslip in ungrouped)
    consolidated.sort(key=_sort_key, reverse=True)
    return consolidated


@router.get("/payslips/period/{year}/{month}", response_model=PayslipDetailResponse)
async def get_payslip_period_detail(
    year: int,
    month: int,
    family: Optional[str] = Query("salary"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id = current_user["tenant_id"]
    account_id = current_user["account_id"]
    resolved_family = family if family in ("salary", "profit_share") else "salary"
    payslips = _fetch_period_payslips(
        db,
        tenant_id=tenant_id,
        account_id=account_id,
        year=year,
        month=month,
        family=resolved_family,
    )
    if not payslips:
        raise HTTPException(status_code=404, detail="Holerite não encontrado")

    payslip_ids = [p.id for p in payslips]
    lines = (
        db.query(PayslipLine)
        .filter(
            PayslipLine.payslip_id.in_(payslip_ids),
            PayslipLine.tenant_id == tenant_id,
            PayslipLine.account_id == account_id,
            PayslipLine.active == True,
        )
        .order_by(PayslipLine.payslip_id.asc(), PayslipLine.id.asc())
        .all()
    )

    consolidated = _consolidate_payslip_group(payslips)
    line_type_map = _get_line_type_map(db, tenant_id, account_id)
    base = consolidated.model_dump()
    base["lines"] = _build_payslip_line_responses(lines, line_type_map)
    has_final = _group_has_final(payslips)
    line_totals = _compute_totals_from_account_lines(lines, has_final=has_final)
    if line_totals["net_amount"] is not None:
        base.update(line_totals)
    base["payments"] = _payments_with_line_fallback(payslips, lines)
    return PayslipDetailResponse(**base)


@router.get("/payslips/{payslip_id}", response_model=PayslipDetailResponse)
async def get_payslip_detail(
    payslip_id: int,
    single: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    payslip = (
        db.query(Payslip)
        .filter(
            Payslip.id == payslip_id,
            Payslip.tenant_id == current_user["tenant_id"],
            Payslip.account_id == current_user["account_id"],
            Payslip.active == True,
        )
        .first()
    )
    if not payslip:
        raise HTTPException(status_code=404, detail="Holerite não encontrado")

    if payslip.year and payslip.month and not single:
        return await get_payslip_period_detail(
            payslip.year,
            payslip.month,
            family=payslip_kind_family(payslip.payslip_kind),
            db=db,
            current_user=current_user,
        )

    tenant_id = current_user["tenant_id"]
    account_id = current_user["account_id"]
    lines = (
        db.query(PayslipLine)
        .filter(
            PayslipLine.payslip_id == payslip_id,
            PayslipLine.tenant_id == tenant_id,
            PayslipLine.account_id == account_id,
            PayslipLine.active == True,
        )
        .order_by(PayslipLine.id.asc())
        .all()
    )
    line_type_map = _get_line_type_map(db, tenant_id, account_id)
    base = PayslipResponse.model_validate(payslip).model_dump()
    base["lines"] = _build_payslip_line_responses(lines, line_type_map)
    has_final = payslip.payslip_kind == "final"
    line_totals = _compute_totals_from_account_lines(lines, has_final=has_final)
    if line_totals["net_amount"] is not None:
        base.update(line_totals)
    base["payments"] = _payments_with_line_fallback([payslip], lines)
    return PayslipDetailResponse(**base)


@router.get("/income-reports", response_model=List[IncomeReportResponse])
async def list_income_reports(
    year: Optional[int] = Query(None),
    payer_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    query = db.query(IncomeReport).filter(
        IncomeReport.tenant_id == current_user["tenant_id"],
        IncomeReport.account_id == current_user["account_id"],
        IncomeReport.active == True,
    )
    if year:
        query = query.filter(IncomeReport.report_year == year)
    if payer_name:
        query = query.filter(IncomeReport.payer_name == payer_name)
    return query.order_by(IncomeReport.report_year.desc().nullslast(), IncomeReport.id.desc()).all()


@router.get("/income-reports/{report_id}", response_model=IncomeReportDetailResponse)
async def get_income_report_detail(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    report = (
        db.query(IncomeReport)
        .filter(
            IncomeReport.id == report_id,
            IncomeReport.tenant_id == current_user["tenant_id"],
            IncomeReport.account_id == current_user["account_id"],
            IncomeReport.active == True,
        )
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Informe de rendimento não encontrado")

    lines = (
        db.query(IncomeReportLine)
        .filter(
            IncomeReportLine.income_report_id == report_id,
            IncomeReportLine.tenant_id == current_user["tenant_id"],
            IncomeReportLine.account_id == current_user["account_id"],
            IncomeReportLine.active == True,
        )
        .order_by(IncomeReportLine.id.asc())
        .all()
    )
    base = IncomeReportResponse.model_validate(report).model_dump()
    line_type_map = _get_line_type_map(db, current_user["tenant_id"], current_user["account_id"])
    base["lines"] = [
        IncomeReportLineResponse.model_validate(x).model_copy(
            update={"line_type_name": line_type_map.get(x.line_type_id)}
        )
        for x in lines
    ]
    return IncomeReportDetailResponse(**base)


def _hard_delete_payslip_records(
    db: Session,
    *,
    tenant_id: int,
    account_id: int,
    payslips: List[Payslip],
) -> int:
    deleted = 0
    for payslip in payslips:
        payslip_id = payslip.id
        db.query(PayslipLine).filter(
            PayslipLine.payslip_id == payslip_id,
            PayslipLine.tenant_id == tenant_id,
            PayslipLine.account_id == account_id,
        ).delete(synchronize_session=False)
        db.delete(payslip)
        deleted += 1
    return deleted


def _hard_delete_payslip_by_id(
    db: Session,
    *,
    tenant_id: int,
    account_id: int,
    payslip_id: int,
) -> int:
    payslip = (
        db.query(Payslip)
        .filter(
            Payslip.id == payslip_id,
            Payslip.tenant_id == tenant_id,
            Payslip.account_id == account_id,
            Payslip.active == True,
        )
        .first()
    )
    if not payslip:
        raise HTTPException(status_code=404, detail="Holerite não encontrado")

    if payslip.year and payslip.month:
        period_payslips = _fetch_period_payslips(
            db,
            tenant_id=tenant_id,
            account_id=account_id,
            year=payslip.year,
            month=payslip.month,
            family=payslip_kind_family(payslip.payslip_kind),
        )
    else:
        period_payslips = [payslip]

    deleted = _hard_delete_payslip_records(
        db,
        tenant_id=tenant_id,
        account_id=account_id,
        payslips=period_payslips,
    )
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Holerite não encontrado")
    return deleted


def _hard_delete_income_report_by_id(
    db: Session,
    *,
    tenant_id: int,
    account_id: int,
    report_id: int,
) -> None:
    report = (
        db.query(IncomeReport)
        .filter(
            IncomeReport.id == report_id,
            IncomeReport.tenant_id == tenant_id,
            IncomeReport.account_id == account_id,
            IncomeReport.active == True,
        )
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Informe de rendimento não encontrado")

    db.query(IncomeReportLine).filter(
        IncomeReportLine.income_report_id == report_id,
        IncomeReportLine.tenant_id == tenant_id,
        IncomeReportLine.account_id == account_id,
    ).delete(synchronize_session=False)
    db.delete(report)


class BulkDeletePayrollRequest(BaseModel):
    payslip_ids: List[int] = []
    income_report_ids: List[int] = []


class BulkDeletePayrollResponse(BaseModel):
    deleted_payslip_periods: int
    deleted_income_reports: int


@router.delete("/payslips/{payslip_id}")
async def delete_payslip(
    payslip_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id = current_user["tenant_id"]
    account_id = current_user["account_id"]
    deleted = _hard_delete_payslip_by_id(
        db,
        tenant_id=tenant_id,
        account_id=account_id,
        payslip_id=payslip_id,
    )
    db.commit()
    return {"success": True, "deleted_payslips": deleted}


@router.delete("/income-reports/{report_id}")
async def delete_income_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id = current_user["tenant_id"]
    account_id = current_user["account_id"]
    _hard_delete_income_report_by_id(
        db,
        tenant_id=tenant_id,
        account_id=account_id,
        report_id=report_id,
    )
    db.commit()
    return {"success": True}


@router.post("/bulk-delete", response_model=BulkDeletePayrollResponse)
async def bulk_delete_payroll(
    payload: BulkDeletePayrollRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    if not payload.payslip_ids and not payload.income_report_ids:
        raise HTTPException(status_code=400, detail="Nenhum item informado para exclusão")

    tenant_id = current_user["tenant_id"]
    account_id = current_user["account_id"]
    deleted_periods = 0
    seen_periods: set[tuple[Optional[int], Optional[int], str]] = set()
    seen_payslip_ids: set[int] = set()

    for payslip_id in payload.payslip_ids:
        payslip = (
            db.query(Payslip)
            .filter(
                Payslip.id == payslip_id,
                Payslip.tenant_id == tenant_id,
                Payslip.account_id == account_id,
                Payslip.active == True,
            )
            .first()
        )
        if not payslip:
            continue

        if payslip.year and payslip.month:
            family = payslip_kind_family(payslip.payslip_kind)
            period_key = (payslip.year, payslip.month, family)
            if period_key in seen_periods:
                continue
            seen_periods.add(period_key)
            deleted_periods += _hard_delete_payslip_records(
                db,
                tenant_id=tenant_id,
                account_id=account_id,
                payslips=_fetch_period_payslips(
                    db,
                    tenant_id=tenant_id,
                    account_id=account_id,
                    year=payslip.year,
                    month=payslip.month,
                    family=family,
                ),
            )
        else:
            if payslip.id in seen_payslip_ids:
                continue
            seen_payslip_ids.add(payslip.id)
            deleted_periods += _hard_delete_payslip_records(
                db,
                tenant_id=tenant_id,
                account_id=account_id,
                payslips=[payslip],
            )

    deleted_income_reports = 0
    seen_report_ids: set[int] = set()
    for report_id in payload.income_report_ids:
        if report_id in seen_report_ids:
            continue
        seen_report_ids.add(report_id)
        try:
            _hard_delete_income_report_by_id(
                db,
                tenant_id=tenant_id,
                account_id=account_id,
                report_id=report_id,
            )
            deleted_income_reports += 1
        except HTTPException:
            continue

    db.commit()
    return BulkDeletePayrollResponse(
        deleted_payslip_periods=deleted_periods,
        deleted_income_reports=deleted_income_reports,
    )
