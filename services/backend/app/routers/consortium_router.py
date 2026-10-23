# -*- coding: utf-8 -*-
import os
import shutil
import tempfile
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.converters.consorcio_pdf import detect_consortium_company, parse_consortium_text
from app.database import get_db
from app.dependencies.auth import require_account
from app.models.base_entity import now_utc
from app.models.unified_models import Consortium, ConsortiumInstallment
from app.utils.account_import_password import (
    account_default_import_file_password,
    load_account_for_user,
)
from app.utils.import_progress import activate_import_job, deactivate_import_job
from app.utils.pdf_password import (
    PdfPasswordInvalid,
    PdfPasswordRequired,
    extract_pdf_text,
    resolve_pdf_password_at_index,
)

router = APIRouter(prefix="/api/consortiums", tags=["consortiums"])

COMPANY_LABEL = {"porto_seguro": "Porto Seguro", "rodobens": "Rodobens"}
SEGMENT_LABEL = {"auto": "Automóvel", "imovel": "Imóvel"}


def _message(exc: Exception) -> str:
    if isinstance(exc, PdfPasswordRequired):
        return "PDF protegido por senha"
    if isinstance(exc, PdfPasswordInvalid):
        return "Senha do PDF incorreta"
    return str(exc)


def _default_password(db: Session, current_user: dict) -> Optional[str]:
    account = load_account_for_user(db, current_user.get("tenant_id"), current_user.get("account_id"))
    return account_default_import_file_password(account)


def _read_pdfs(files: List[UploadFile], passwords: List[str], default_password: Optional[str]):
    """Gera (filename, texto|None, erro|None) para cada PDF."""
    temp_dir = tempfile.mkdtemp()
    try:
        for index, file in enumerate(files):
            filename = file.filename or "arquivo.pdf"
            if not filename.lower().endswith(".pdf"):
                yield filename, None, "Arquivo não é PDF"
                continue
            path = os.path.join(temp_dir, f"{index}_{os.path.basename(filename)}")
            with open(path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            try:
                password = resolve_pdf_password_at_index(passwords, index, default_password)
                yield filename, extract_pdf_text(path, password), None
            except Exception as ex:
                yield filename, None, _message(ex)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/classify-pdfs")
def classify_consortium_pdfs(
    files: List[UploadFile] = File(...),
    passwords: List[str] = Form([]),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo fornecido")
    results: List[Dict[str, Any]] = []
    for filename, text, error in _read_pdfs(files, passwords, _default_password(db, current_user)):
        if error or text is None:
            results.append({"filename": filename, "status": "error", "message": error})
            continue
        company = detect_consortium_company(text)
        if not company:
            results.append({"filename": filename, "status": "not_consortium"})
            continue
        try:
            parsed = parse_consortium_text(text)
        except Exception as ex:
            results.append({"filename": filename, "status": "error", "message": str(ex)})
            continue
        existing = (
            db.query(Consortium.id)
            .filter(
                Consortium.tenant_id == current_user.get("tenant_id"),
                Consortium.account_id == current_user.get("account_id"),
                Consortium.company == company,
                Consortium.group_code == parsed["group_code"],
                Consortium.quota == parsed["quota"],
            )
            .first()
        )
        results.append({
            "filename": filename, "status": "ok", "company": company,
            "company_label": COMPANY_LABEL[company], "segment": parsed["segment"],
            "group_code": parsed["group_code"], "quota": parsed["quota"],
            "installment_count": len(parsed["installments"]),
            "action": "updated" if existing else "created",
        })
    return {"results": results}


def _import_work(files, passwords, db: Session, current_user: dict):
    tenant_id = current_user.get("tenant_id")
    account_id = current_user.get("account_id")
    user_id = current_user.get("user_id") or current_user.get("id")
    results: List[Dict[str, Any]] = []
    for filename, text, error in _read_pdfs(files, passwords, _default_password(db, current_user)):
        if error or text is None:
            results.append({"filename": filename, "status": "error", "message": error})
            continue
        try:
            parsed = parse_consortium_text(text)
            rows = parsed.pop("installments")
            entity = (
                db.query(Consortium)
                .filter(
                    Consortium.tenant_id == tenant_id,
                    Consortium.account_id == account_id,
                    Consortium.company == parsed["company"],
                    Consortium.group_code == parsed["group_code"],
                    Consortium.quota == parsed["quota"],
                )
                .first()
            )
            action = "updated" if entity else "created"
            if entity is None:
                entity = Consortium(tenant_id=tenant_id, account_id=account_id, created_by=user_id)
                db.add(entity)
            for key, value in parsed.items():
                setattr(entity, key, value)
            entity.source_filename = filename
            entity.imported_at = now_utc()
            entity.active = True
            db.flush()
            db.query(ConsortiumInstallment).filter(ConsortiumInstallment.consortium_id == entity.id).delete()
            for row in rows:
                db.add(ConsortiumInstallment(
                    tenant_id=tenant_id, account_id=account_id, created_by=user_id,
                    consortium_id=entity.id, **row,
                ))
            db.commit()
            results.append({
                "filename": filename, "status": "ok", "action": action,
                "record_id": entity.id, "installment_count": len(rows),
            })
        except Exception as ex:
            db.rollback()
            results.append({"filename": filename, "status": "error", "message": str(ex)})
    return {"success": all(r["status"] == "ok" for r in results), "results": results}


@router.post("/import-pdfs")
def import_consortium_pdfs(
    files: List[UploadFile] = File(...),
    passwords: List[str] = Form([]),
    progress_job_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo fornecido")
    scope = activate_import_job(progress_job_id, current_user)
    try:
        return _import_work(files, passwords, db, current_user)
    finally:
        deactivate_import_job(scope)


def _num(value) -> Optional[float]:
    return float(value) if value is not None else None


def _summary(c: Consortium) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for col in Consortium.__table__.columns:
        if col.name in ("tenant_id", "account_id", "created_by", "updated_by", "created_at", "updated_at"):
            continue
        value = getattr(c, col.name, None)
        out[col.name] = _num(value) if hasattr(value, "quantize") else (value.isoformat() if hasattr(value, "isoformat") else value)
    out["company_label"] = COMPANY_LABEL.get(c.company, c.company)
    out["segment_label"] = SEGMENT_LABEL.get(c.segment, c.segment)
    out["remaining_installments"] = max(0, (c.plan_term_months or 0) - (c.paid_installments or 0))
    out["open_regular_installments"] = max(0, out["remaining_installments"] - (c.catch_up_installments or 0))
    # Total pago líquido: pagamentos menos estornos (estorno é gravado negativo).
    out["total_paid"] = _num(sum((r.amount_paid or Decimal(0)) for r in c.installments))
    # Fechado: encerrado manualmente (active = false) ou todas as parcelas do plano pagas.
    out["auto_closed"] = bool(c.plan_term_months) and (c.paid_installments or 0) >= c.plan_term_months
    out["is_closed"] = (not c.active) or out["auto_closed"]
    return out


@router.get("")
def list_consortiums(db: Session = Depends(get_db), current_user: dict = Depends(require_account)):
    items = (
        db.query(Consortium)
        .filter(
            Consortium.tenant_id == current_user.get("tenant_id"),
            Consortium.account_id == current_user.get("account_id"),
        )
        .order_by(Consortium.company, Consortium.group_code, Consortium.quota)
        .all()
    )
    return [_summary(c) for c in items]


@router.get("/{consortium_id}")
def get_consortium(consortium_id: int, db: Session = Depends(get_db), current_user: dict = Depends(require_account)):
    c = (
        db.query(Consortium)
        .filter(
            Consortium.id == consortium_id,
            Consortium.tenant_id == current_user.get("tenant_id"),
            Consortium.account_id == current_user.get("account_id"),
        )
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="Consórcio não encontrado")
    installments = []
    for r in c.installments:
        item = {}
        for col in ConsortiumInstallment.__table__.columns:
            if col.name in ("tenant_id", "account_id", "created_by", "updated_by", "created_at", "updated_at"):
                continue
            value = getattr(r, col.name, None)
            item[col.name] = _num(value) if hasattr(value, "quantize") else (value.isoformat() if hasattr(value, "isoformat") else value)
        installments.append(item)
    installments.sort(
        key=lambda i: (i["installment_number"] is not None, i["installment_number"] or 0, i["payment_date"] or i["due_date"] or ""),
        reverse=True,
    )
    return {**_summary(c), "installments": installments}



class ConsortiumUpdateRequest(BaseModel):
    """
    Campos editáveis do consórcio (não vêm no extrato; informados pelo usuário).
    Só os campos enviados são atualizados; enviar null limpa o valor.
    """
    catch_up_installment_amount: Optional[Decimal] = None  # valor positivo; gravado negativo
    reduction_factor: Optional[Decimal] = None  # % (0–100) — fator de redução da parcela


@router.put("/{consortium_id}")
def update_consortium(
    consortium_id: int,
    payload: ConsortiumUpdateRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    c = (
        db.query(Consortium)
        .filter(
            Consortium.id == consortium_id,
            Consortium.tenant_id == current_user.get("tenant_id"),
            Consortium.account_id == current_user.get("account_id"),
        )
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="Consórcio não encontrado")
    sent = payload.model_fields_set
    if "catch_up_installment_amount" in sent:
        # O furo é sempre despesa: independente do sinal recebido, gravamos negativo.
        amount = payload.catch_up_installment_amount
        c.catch_up_installment_amount = -abs(amount) if amount else None
    if "reduction_factor" in sent:
        factor = payload.reduction_factor
        if factor is not None and not (Decimal(0) <= factor <= Decimal(100)):
            raise HTTPException(status_code=400, detail="O fator de redução deve estar entre 0 e 100")
        c.reduction_factor = factor
    db.commit()
    db.refresh(c)
    return _summary(c)


class ConsortiumStatusRequest(BaseModel):
    active: bool


@router.patch("/{consortium_id}/status")
def set_consortium_status(
    consortium_id: int,
    payload: ConsortiumStatusRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Encerra (active = false) ou reabre (active = true) o consórcio."""
    c = (
        db.query(Consortium)
        .filter(
            Consortium.id == consortium_id,
            Consortium.tenant_id == current_user.get("tenant_id"),
            Consortium.account_id == current_user.get("account_id"),
        )
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="Consórcio não encontrado")
    c.active = payload.active
    db.commit()
    db.refresh(c)
    return _summary(c)


class BulkDeleteRequest(BaseModel):
    ids: List[int]


@router.post("/bulk-delete")
def bulk_delete_consortiums(
    payload: BulkDeleteRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Exclui vários consórcios (e seus lançamentos) da conta atual."""
    if not payload.ids:
        raise HTTPException(status_code=400, detail="Nenhum consórcio informado")
    items = (
        db.query(Consortium)
        .filter(
            Consortium.id.in_(payload.ids),
            Consortium.tenant_id == current_user.get("tenant_id"),
            Consortium.account_id == current_user.get("account_id"),
        )
        .all()
    )
    for c in items:
        db.delete(c)
    db.commit()
    return {"deleted": len(items)}


@router.delete("/{consortium_id}")
def delete_consortium(consortium_id: int, db: Session = Depends(get_db), current_user: dict = Depends(require_account)):
    """Exclui o consórcio e todos os seus lançamentos (parcelas)."""
    c = (
        db.query(Consortium)
        .filter(
            Consortium.id == consortium_id,
            Consortium.tenant_id == current_user.get("tenant_id"),
            Consortium.account_id == current_user.get("account_id"),
        )
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="Consórcio não encontrado")
    installments_deleted = len(c.installments)
    db.delete(c)
    db.commit()
    return {"deleted": True, "installments_deleted": installments_deleted}
