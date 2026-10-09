# -*- coding: utf-8 -*-
"""Importação visual de extrato/benefício a partir do Excel exportado pelo Plumo."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal, Optional, TypeVar

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.services.import_batch import ImportBatch
from app.models.unified_models import (
    Account,
    BankStatement,
    BenefitCardStatement,
    Cartao,
    ExpenseSharingSetting,
    Subtag,
    Tag,
)
from app.services.account_period_closure_service import (
    AccountPeriodClosedError,
    _money as closure_money,
    closed_periods,
)
from app.services.closed_period_edit_service import (
    ChangeKind,
    _cash_adjustment_periods_from_dates,
    _downstream_closed_periods,
    _period_from_date,
    after_bank_statement_updated,
    apply_cash_closure_recalc,
    classify_transaction_edit,
    closure_impact_confirmation_prompt,
    closure_impact_none,
    merge_closure_impacts,
    closure_impact_classification,
    refresh_closed_snapshots_for_periods,
)

RowSource = Literal["bank", "benefit"]

SHARING_COL = "Conta Parceira"
OWNERSHIP_COL = "Parte na sua conta (%)"


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


ISSUE_IGNORED = "Linha ignorada"
ISSUE_NOT_CREATED = "Não será criado"
ISSUE_NO_CLASSIFICATION = "Sem classificação"
ISSUE_NO_SHARING = "Sem compartilhamento"


def _tx_issue_detail(raw: dict[str, Any]) -> str | None:
    parts = [_normalize_text(raw.get("date")), _normalize_text(raw.get("description"))]
    amount = raw.get("amount")
    if isinstance(amount, (int, float, Decimal)):
        parts.append(f"R$ {float(amount):,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
    elif amount not in (None, ""):
        parts.append(_normalize_text(amount))
    text = " · ".join(p for p in parts if p)
    return text or None


def _parse_br_datetime(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    for fmt in (
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _normalize_amount_text(text: str) -> str:
    """Aceita pt-BR (10.000,00), en-US (10,000.00) ou decimal simples (10000.00)."""
    text = text.strip()
    if not text:
        return text
    has_comma = "," in text
    has_dot = "." in text
    if has_comma and has_dot:
        if text.rfind(",") > text.rfind("."):
            return text.replace(".", "").replace(",", ".")
        return text.replace(",", "")
    if has_comma:
        return text.replace(".", "").replace(",", ".")
    if has_dot:
        parts = text.split(".")
        if len(parts) == 2 and len(parts[1]) <= 2:
            return text
        return text.replace(".", "")
    return text


def _parse_amount(value: Any) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float, Decimal)):
        return closure_money(value)
    try:
        return closure_money(_normalize_amount_text(str(value)))
    except Exception:
        return None


def _ownership_or_full(value: Any) -> Decimal:
    """Parte da conta logada; 0% é válido (gerenciado), só a ausência vira 100%."""
    return Decimal("100.00") if value is None or value == "" else Decimal(str(value))


def _resolve_subtag(
    db: Session,
    tenant_id: int,
    account_id: int,
    tag_name: str,
    subtag_name: str,
    amount: Decimal,
) -> tuple[Optional[int], Optional[str]]:
    tag_name = _normalize_text(tag_name)
    subtag_name = _normalize_text(subtag_name)
    if not subtag_name:
        return None, None
    tipo = "receita" if amount >= 0 else "despesa"
    q = (
        db.query(Subtag)
        .join(Tag, Tag.id == Subtag.tag_id)
        .filter(
            Subtag.tenant_id == tenant_id,
            Tag.account_id == account_id,
            func.lower(Subtag.name) == subtag_name.lower(),
            Subtag.type == tipo,
        )
    )
    if tag_name:
        q = q.filter(func.lower(Tag.name) == tag_name.lower())
    row = q.first()
    if not row:
        hint = f"{tag_name}/{subtag_name}" if tag_name else subtag_name
        return None, f"Subtag não encontrada: {hint}"
    return int(row.id), None


def _resolve_sharing(
    db: Session,
    tenant_id: int,
    account_id: int,
    partner_name: str,
    ownership: Any,
) -> tuple[Optional[int], Optional[Decimal], Optional[str]]:
    """Aceita a config direta (minha) ou a inversa (criada pelo parceiro), nessa ordem.

    O percentual da planilha já vem na perspectiva da conta logada; sem ele, usa o
    padrão da config (invertido quando a config pertence ao parceiro).
    """
    partner_name = _normalize_text(partner_name)
    if not partner_name:
        return None, Decimal("100.00"), None
    partner_ids = [
        int(pid)
        for (pid,) in db.query(Account.id)
        .filter(
            Account.tenant_id == tenant_id,
            func.lower(Account.name) == partner_name.lower(),
            Account.active == True,
            Account.id != account_id,
        )
        .order_by(Account.id.asc())
        .all()
    ]
    if not partner_ids:
        return None, None, f"Conta parceira não encontrada: {partner_name}"
    settings = (
        db.query(ExpenseSharingSetting)
        .filter(
            ExpenseSharingSetting.tenant_id == tenant_id,
            ExpenseSharingSetting.active == True,
            or_(
                and_(
                    ExpenseSharingSetting.account_id == account_id,
                    ExpenseSharingSetting.shared_account_id.in_(partner_ids),
                ),
                and_(
                    ExpenseSharingSetting.account_id.in_(partner_ids),
                    ExpenseSharingSetting.shared_account_id == account_id,
                ),
            ),
        )
        .all()
    )
    if not settings:
        return None, None, f"Compartilhamento não configurado com: {partner_name}"
    setting = min(settings, key=lambda s: (s.account_id != account_id, s.id))
    pct = _parse_amount(ownership)
    if pct is None:
        default_pct = Decimal(str(setting.my_contribution_percentage if setting.my_contribution_percentage is not None else 100))
        pct = default_pct if setting.account_id == account_id else Decimal("100.00") - default_pct
    return int(setting.id), pct, None


def _day_range(dt: datetime) -> tuple[datetime, datetime]:
    start = datetime(dt.year, dt.month, dt.day)
    end = start + timedelta(days=1)
    return start, end


def _description_matches(db_description: str, normalized_lower: str) -> bool:
    return _normalize_text(db_description).lower() == normalized_lower


TxRow = TypeVar("TxRow", BankStatement, BenefitCardStatement)


def _file_dates(rows: list[dict[str, Any]]) -> list[datetime]:
    return [dt for dt in (_parse_br_datetime(raw.get("date")) for raw in rows) if dt]


def _load_day_index(
    db: Session,
    model: type[TxRow],
    tenant_id: int,
    account_id: int,
    dates: list[datetime],
) -> tuple[dict[date, list[TxRow]], dict[int, TxRow]]:
    """Carrega de uma vez os lançamentos da conta no intervalo de datas do arquivo."""
    by_day: dict[date, list[TxRow]] = {}
    by_id: dict[int, TxRow] = {}
    if not dates:
        return by_day, by_id
    start, _ = _day_range(min(dates))
    _, end = _day_range(max(dates))
    rows = (
        db.query(model)
        .filter(
            model.tenant_id == tenant_id,
            model.account_id == account_id,
            model.date >= start,
            model.date < end,
        )
        .order_by(model.id.asc())
        .all()
    )
    for row in rows:
        if row.date is None:
            continue
        by_day.setdefault(row.date.date(), []).append(row)
        by_id[int(row.id)] = row
    return by_day, by_id


def _pick_day_match(
    day_rows: list[TxRow],
    description: str,
    amount: Decimal,
    exclude_ids: set[int],
) -> Optional[TxRow]:
    desc_norm = _normalize_text(description).lower()
    rows = [
        r
        for r in day_rows
        if r.id not in exclude_ids and _description_matches(r.description or "", desc_norm)
    ]
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    amount_norm = closure_money(amount)
    for row in rows:
        if closure_money(row.amount) == amount_norm:
            return row
    return None


def _card_last4(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))[-4:]


class _BenefitCards:
    """Cartões de benefício ativos da conta, carregados uma vez por import."""

    def __init__(self, db: Session, tenant_id: int, account_id: int):
        rows = (
            db.query(Cartao.id, Cartao.number)
            .filter(
                Cartao.tenant_id == tenant_id,
                Cartao.account_id == account_id,
                Cartao.type == "beneficios",
                Cartao.active == True,
            )
            .order_by(Cartao.id.asc())
            .all()
        )
        self._cards = [(int(cid), str(num).replace(" ", "")[-4:] if num else "") for cid, num in rows]

    def ids_for(self, card_last4: str) -> Optional[set[int]]:
        """None = qualquer cartão; conjunto vazio = final informado sem cartão correspondente."""
        last4 = _card_last4(card_last4)
        if not last4:
            return None
        return {cid for cid, num in self._cards if num == last4}

    def resolve(self, card_last4: str) -> Optional[int]:
        last4 = _card_last4(card_last4)
        if last4:
            return next((cid for cid, num in self._cards if num == last4), None)
        return self._cards[0][0] if self._cards else None


def _classify_bank_change(
    before: BankStatement,
    *,
    amount: Decimal,
    dt: datetime,
    subtag_id: int | None,
    sharing_id: int | None,
    ownership: Decimal,
) -> ChangeKind:
    return classify_transaction_edit(
        old_amount=before.amount,
        new_amount=amount,
        old_date=before.date,
        new_date=dt,
        old_subtag_id=before.subtag_id,
        new_subtag_id=subtag_id,
        old_sharing_id=before.expense_sharing_id,
        new_sharing_id=sharing_id,
        old_ownership=before.ownership_percentage,
        new_ownership=ownership,
    )


def _collect_closed_periods_for_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    mutations: list[tuple[ChangeKind, Any, Any]],
) -> tuple[set[tuple[int, int]], ChangeKind]:
    closed = closed_periods(db, tenant_id, account_id)
    if not closed:
        return set(), "noop"
    periods: set[tuple[int, int]] = set()
    worst: ChangeKind = "noop"
    rank = {"noop": 0, "classification": 1, "split_only": 2, "cash": 3}
    for kind, old_date, new_date in mutations:
        if kind == "noop":
            continue
        if rank.get(kind, 0) > rank.get(worst, 0):
            worst = kind
        seed: set[tuple[int, int]] = set()
        for value in (old_date, new_date):
            period = _period_from_date(value)
            if period and period in closed:
                seed.add(period)
        if kind == "cash" and seed:
            for p in _downstream_closed_periods(closed, seed):
                periods.add((p[0], p[1]))
        elif seed:
            periods.update(seed)
    return periods, worst


def _subtag_label(db: Session, tenant_id: int, subtag_id: int | None) -> Optional[str]:
    if not subtag_id:
        return None
    row = (
        db.query(Subtag.name, Tag.name.label("tag_name"))
        .join(Tag, Tag.id == Subtag.tag_id)
        .filter(Subtag.id == subtag_id, Subtag.tenant_id == tenant_id)
        .first()
    )
    if not row:
        return None
    return f"{row.tag_name}/{row.name}" if row.tag_name else row.name


def _sharing_label(
    db: Session, tenant_id: int, sharing_id: int | None, account_id: int | None = None,
) -> Optional[str]:
    """Nome da contraparte; com account_id, resolve também configs criadas pelo parceiro."""
    if not sharing_id:
        return None
    setting = (
        db.query(ExpenseSharingSetting.account_id, ExpenseSharingSetting.shared_account_id)
        .filter(
            ExpenseSharingSetting.id == sharing_id,
            ExpenseSharingSetting.tenant_id == tenant_id,
        )
        .first()
    )
    if not setting:
        return None
    partner_id = (
        setting.account_id
        if account_id is not None and setting.account_id != account_id
        else setting.shared_account_id
    )
    row = db.query(Account.name).filter(Account.id == partner_id, Account.tenant_id == tenant_id).first()
    return row.name if row else None


def _file_classification_label(tag: str, subtag: str) -> str:
    tag = _normalize_text(tag)
    subtag = _normalize_text(subtag)
    if tag and subtag:
        return f"{tag}/{subtag}"
    if subtag:
        return subtag
    if tag:
        return tag
    return ""


class LookupCache:
    """Memoiza subtag, compartilhamento e rótulos repetidos ao longo de um import."""

    def __init__(self, db: Session, tenant_id: int, account_id: int):
        self.db = db
        self.tenant_id = tenant_id
        self.account_id = account_id
        self._subtags: dict[tuple[str, str, str], tuple[Optional[int], Optional[str]]] = {}
        self._sharings: dict[tuple[str, str], tuple[Optional[int], Optional[Decimal], Optional[str]]] = {}
        self._subtag_labels: dict[Optional[int], Optional[str]] = {}
        self._sharing_labels: dict[Optional[int], Optional[str]] = {}

    def subtag(self, tag_name: str, subtag_name: str, amount: Decimal) -> tuple[Optional[int], Optional[str]]:
        key = (tag_name, subtag_name, "receita" if amount >= 0 else "despesa")
        if key not in self._subtags:
            self._subtags[key] = _resolve_subtag(
                self.db, self.tenant_id, self.account_id, tag_name, subtag_name, amount,
            )
        return self._subtags[key]

    def sharing(
        self, partner_name: str, ownership: Any,
    ) -> tuple[Optional[int], Optional[Decimal], Optional[str]]:
        key = (partner_name, str(ownership))
        if key not in self._sharings:
            self._sharings[key] = _resolve_sharing(
                self.db, self.tenant_id, self.account_id, partner_name, ownership,
            )
        return self._sharings[key]

    def subtag_label(self, subtag_id: Optional[int]) -> Optional[str]:
        if subtag_id not in self._subtag_labels:
            self._subtag_labels[subtag_id] = _subtag_label(self.db, self.tenant_id, subtag_id)
        return self._subtag_labels[subtag_id]

    def sharing_label(self, sharing_id: Optional[int]) -> Optional[str]:
        if sharing_id not in self._sharing_labels:
            self._sharing_labels[sharing_id] = _sharing_label(
                self.db, self.tenant_id, sharing_id, self.account_id,
            )
        return self._sharing_labels[sharing_id]


def _plan_visual_extrato_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    *,
    bank_rows: list[dict[str, Any]],
    benefit_rows: list[dict[str, Any]],
    batch: ImportBatch | None = None,
) -> dict[str, Any]:
    mutations: list[tuple[ChangeKind, Any, Any]] = []
    issues: list[dict[str, Any]] = []
    planned: list[dict[str, Any]] = []
    skipped = 0
    kept = 0
    used_bank_ids: set[int] = set()
    used_benefit_ids: set[int] = set()
    lookup = LookupCache(db, tenant_id, account_id)
    benefit_cards = _BenefitCards(db, tenant_id, account_id)
    bank_by_day, bank_by_id = _load_day_index(
        db, BankStatement, tenant_id, account_id, _file_dates(bank_rows),
    )
    benefit_by_day, benefit_by_id = _load_day_index(
        db, BenefitCardStatement, tenant_id, account_id, _file_dates(benefit_rows),
    )

    for idx, raw in enumerate(bank_rows):
        line = int(raw.get("row_index") or idx + 2)
        dt = _parse_br_datetime(raw.get("date"))
        description = _normalize_text(raw.get("description"))
        amount = _parse_amount(raw.get("amount"))
        if not dt or not description or amount is None:
            issues.append({
                "source": "bank",
                "row": line,
                "reason": "Data, descrição ou valor inválidos",
                "detail": _tx_issue_detail(raw),
                "action": ISSUE_IGNORED,
            })
            skipped += 1
            continue
        tag_file = str(raw.get("tag") or "")
        subtag_file = str(raw.get("subtag") or "")
        tipo = "receita" if amount >= 0 else "despesa"
        subtag_id, sub_err = lookup.subtag(tag_file, subtag_file, amount)
        if sub_err and not (batch and batch.has_subtag(tag_file, subtag_file, tipo)):
            issues.append({
                "source": "bank",
                "row": line,
                "reason": sub_err,
                "detail": _tx_issue_detail(raw),
                "action": ISSUE_NO_CLASSIFICATION,
            })
        elif sub_err:
            sub_err = None
        partner_file = str(raw.get("partner_name") or "")
        sharing_id, ownership, share_err = lookup.sharing(partner_file, raw.get("ownership_percentage"))
        if share_err and not (batch and batch.has_sharing(partner_file)):
            issues.append({
                "source": "bank",
                "row": line,
                "reason": share_err,
                "detail": _tx_issue_detail(raw),
                "action": ISSUE_NO_SHARING,
            })
            sharing_id = None
            ownership = Decimal("100.00")
        elif share_err:
            share_err = None
            sharing_id = None
            ownership = Decimal("100.00")
        existing = _pick_day_match(bank_by_day.get(dt.date(), []), description, amount, used_bank_ids)
        if existing and raw.get("keep_existing"):
            used_bank_ids.add(int(existing.id))
            kept += 1
            continue
        meta = {
            "line": line,
            "dt": dt,
            "description": description,
            "amount": amount,
            "subtag_id": subtag_id,
            "sharing_id": sharing_id,
            "ownership": _ownership_or_full(ownership),
            "tag_file": tag_file,
            "subtag_file": subtag_file,
            "partner_file": partner_file,
            "sub_err": sub_err,
            "share_err": share_err,
            "category": _normalize_text(raw.get("category")),
            "transaction": _normalize_text(raw.get("transaction")),
        }
        if existing:
            used_bank_ids.add(int(existing.id))
            kind = _classify_bank_change(
                existing,
                amount=amount,
                dt=dt,
                subtag_id=subtag_id,
                sharing_id=sharing_id,
                ownership=_ownership_or_full(ownership),
            )
            mutations.append((kind, existing.date, dt))
            planned.append({"action": "update_bank", "id": existing.id, "kind": kind, **meta})
        else:
            mutations.append(("cash", None, dt))
            planned.append({"action": "create_bank", "kind": "cash", **meta})

    for idx, raw in enumerate(benefit_rows):
        line = int(raw.get("row_index") or idx + 2)
        dt = _parse_br_datetime(raw.get("date"))
        description = _normalize_text(raw.get("description"))
        amount = _parse_amount(raw.get("amount"))
        if not dt or not description or amount is None:
            issues.append({
                "source": "benefit",
                "row": line,
                "reason": "Data, descrição ou valor inválidos",
                "detail": _tx_issue_detail(raw),
                "action": ISSUE_IGNORED,
            })
            skipped += 1
            continue
        tag_file = str(raw.get("tag") or "")
        subtag_file = str(raw.get("subtag") or "")
        tipo = "receita" if amount >= 0 else "despesa"
        subtag_id, sub_err = lookup.subtag(tag_file, subtag_file, amount)
        if sub_err and not (batch and batch.has_subtag(tag_file, subtag_file, tipo)):
            issues.append({
                "source": "benefit",
                "row": line,
                "reason": sub_err,
                "detail": _tx_issue_detail(raw),
                "action": ISSUE_NO_CLASSIFICATION,
            })
        elif sub_err:
            sub_err = None
        partner_file = str(raw.get("partner_name") or "")
        sharing_id, ownership, share_err = lookup.sharing(partner_file, raw.get("ownership_percentage"))
        if share_err and not (batch and batch.has_sharing(partner_file)):
            issues.append({
                "source": "benefit",
                "row": line,
                "reason": share_err,
                "detail": _tx_issue_detail(raw),
                "action": ISSUE_NO_SHARING,
            })
            sharing_id = None
            ownership = Decimal("100.00")
        elif share_err:
            share_err = None
            sharing_id = None
            ownership = Decimal("100.00")
        card_last4 = str(raw.get("card_last4") or "")
        card_ids = benefit_cards.ids_for(card_last4)
        day_rows = benefit_by_day.get(dt.date(), [])
        if card_ids is not None:
            day_rows = [r for r in day_rows if r.credit_card_id in card_ids]
        existing = _pick_day_match(day_rows, description, amount, used_benefit_ids)
        if existing and raw.get("keep_existing"):
            used_benefit_ids.add(int(existing.id))
            kept += 1
            continue
        meta = {
            "line": line,
            "dt": dt,
            "description": description,
            "amount": amount,
            "subtag_id": subtag_id,
            "sharing_id": sharing_id,
            "ownership": _ownership_or_full(ownership),
            "tag_file": tag_file,
            "subtag_file": subtag_file,
            "partner_file": partner_file,
            "sub_err": sub_err,
            "share_err": share_err,
            "card_last4": card_last4,
            "payment_method": _normalize_text(raw.get("payment_method")) or "Importado",
        }
        if existing:
            used_benefit_ids.add(int(existing.id))
            kind = classify_transaction_edit(
                old_amount=existing.amount,
                new_amount=amount,
                old_date=existing.date,
                new_date=dt,
                old_subtag_id=existing.subtag_id,
                new_subtag_id=subtag_id,
                old_sharing_id=existing.expense_sharing_id,
                new_sharing_id=sharing_id,
                old_ownership=existing.ownership_percentage,
                new_ownership=_ownership_or_full(ownership),
            )
            mutations.append((kind, existing.date, dt))
            planned.append({"action": "update_benefit", "id": existing.id, "kind": kind, **meta})
        else:
            card_ok = benefit_cards.resolve(card_last4) is not None
            if not card_ok and batch and batch.has_benefit_card(card_last4):
                card_ok = True
                meta["card_err"] = "Cartão entra com o cadastro desta leva"
            if not card_ok:
                issues.append({
                    "source": "benefit",
                    "row": line,
                    "reason": "Cartão de benefício não encontrado para criar lançamento",
                    "detail": _tx_issue_detail(raw),
                    "action": ISSUE_NOT_CREATED,
                })
            mutations.append(("cash", None, dt))
            planned.append({"action": "create_benefit", "kind": "cash", "can_create": card_ok, **meta})

    return {
        "planned": planned,
        "issues": issues,
        "mutations": mutations,
        "skipped": skipped,
        "kept": kept,
        "lookup": lookup,
        "benefit_cards": benefit_cards,
        "bank_by_id": bank_by_id,
        "benefit_by_id": benefit_by_id,
    }


def _append_change(changes: list[dict], field: str, before: Any, after: Any) -> None:
    b = before if before not in (None, "") else None
    a = after if after not in (None, "") else None
    if b == a:
        return
    changes.append({"field": field, "before": b, "after": a})


def preview_visual_extrato_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    *,
    bank_rows: list[dict[str, Any]],
    benefit_rows: list[dict[str, Any]],
    batch: ImportBatch | None = None,
) -> dict[str, Any]:
    plan = _plan_visual_extrato_import(
        db, tenant_id, account_id, bank_rows=bank_rows, benefit_rows=benefit_rows, batch=batch,
    )
    lookup: LookupCache = plan["lookup"]
    creates: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    unchanged = 0

    for item in plan["planned"]:
        source = "bank" if "bank" in item["action"] else "benefit"
        action = "create" if item["action"].startswith("create") else "update"
        if action == "create" and item["action"] == "create_benefit" and not item.get("can_create", True):
            continue

        after_subtag = lookup.subtag_label(item.get("subtag_id"))
        after_sharing = lookup.sharing_label(item.get("sharing_id"))
        ownership = float(_ownership_or_full(item.get("ownership")))
        null_fields = []
        file_cls = _file_classification_label(item.get("tag_file", ""), item.get("subtag_file", ""))
        if item.get("card_err"):
            null_fields.append({
                "field": "card",
                "file_value": item.get("card_last4") or None,
                "reason": item["card_err"],
            })
        if item.get("sub_err"):
            null_fields.append({
                "field": "subtag",
                "file_value": file_cls or None,
                "reason": item["sub_err"],
            })
        elif not file_cls:
            null_fields.append({
                "field": "subtag",
                "file_value": None,
                "reason": "Sem tag/subtag na planilha → ficará vazio",
            })
        if item.get("share_err"):
            null_fields.append({
                "field": "sharing",
                "file_value": item.get("partner_file") or None,
                "reason": item["share_err"],
            })
        elif not _normalize_text(item.get("partner_file")):
            null_fields.append({
                "field": "sharing",
                "file_value": None,
                "reason": "Sem parceiro na planilha → próprio (100%)",
            })

        base = {
            "source": source,
            "row": item["line"],
            "action": action,
            "date": item["dt"].strftime("%d/%m/%Y %H:%M"),
            "description": item["description"][:120],
            "amount": float(item["amount"]),
            "classification_after": after_subtag,
            "classification_file": file_cls or None,
            "sharing_after": after_sharing,
            "sharing_file": _normalize_text(item.get("partner_file")) or None,
            "ownership_after": ownership if after_sharing else None,
            "ownership_file": item.get("ownership_percentage"),
            "null_fields": null_fields,
        }

        if action == "create":
            creates.append({**base, "record_id": None})
            continue

        record_id = item["id"]
        by_id = plan["bank_by_id"] if item["action"] == "update_bank" else plan["benefit_by_id"]
        row = by_id.get(int(record_id))
        if not row:
            continue

        changes: list[dict[str, Any]] = []
        _append_change(changes, "amount", float(row.amount), float(item["amount"]))
        _append_change(changes, "date", row.date.strftime("%d/%m/%Y %H:%M"), item["dt"].strftime("%d/%m/%Y %H:%M"))
        _append_change(changes, "subtag", lookup.subtag_label(row.subtag_id), after_subtag)
        _append_change(changes, "sharing", lookup.sharing_label(row.expense_sharing_id), after_sharing)
        if after_sharing or row.expense_sharing_id:
            _append_change(
                changes,
                "ownership_pct",
                float(row.ownership_percentage) if row.expense_sharing_id else None,
                ownership if after_sharing else None,
            )

        if not changes and item.get("kind") == "noop":
            unchanged += 1
            continue

        updates.append({**base, "record_id": record_id, "changes": changes})

    return {
        "summary": {
            "creates": len(creates),
            "updates": len(updates),
            "unchanged": unchanged,
            "kept": plan["kept"],
            "skipped_invalid": plan["skipped"],
            "issues": len(plan["issues"]),
        },
        "creates": creates,
        "updates": updates,
        "issues": plan["issues"],
    }


def ensure_visual_extrato_import_allowed(
    db: Session,
    tenant_id: int,
    account_id: int,
    mutations: list[tuple[ChangeKind, Any, Any]],
    confirm: bool,
) -> None:
    if confirm:
        return
    periods, kind = _collect_closed_periods_for_import(db, tenant_id, account_id, mutations)
    if not periods or kind == "noop":
        return
    preview = closure_impact_confirmation_prompt(
        "financial" if kind == "cash" else ("split_recalc" if kind == "split_only" else "classification"),
    )
    raise AccountPeriodClosedError(preview.get("message", "Confirme o impacto nos fechamentos."), preview)


def apply_visual_extrato_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    *,
    bank_rows: list[dict[str, Any]],
    benefit_rows: list[dict[str, Any]],
    confirm_closed_closure_impact: bool,
) -> dict[str, Any]:
    plan = _plan_visual_extrato_import(
        db, tenant_id, account_id, bank_rows=bank_rows, benefit_rows=benefit_rows,
    )
    planned = plan["planned"]
    issues: list[dict[str, Any]] = list(plan["issues"])
    mutations = plan["mutations"]
    stats = {
        "bank_updated": 0,
        "bank_created": 0,
        "benefit_updated": 0,
        "benefit_created": 0,
        "kept": plan["kept"],
        "skipped": plan["skipped"],
    }

    ensure_visual_extrato_import_allowed(
        db, tenant_id, account_id, mutations, confirm_closed_closure_impact,
    )

    closure_impact: dict[str, Any] = closure_impact_none()
    cash_periods: set[tuple[int, int]] = set()
    benefit_refresh_periods: set[tuple[int, int]] = set()
    closed = closed_periods(db, tenant_id, account_id)

    for item in planned:
        if item["action"] == "update_bank":
            row = plan["bank_by_id"].get(int(item["id"]))
            if not row:
                issues.append({"source": "bank", "row": item["line"], "reason": "Registro não encontrado"})
                continue
            old_date = row.date
            kind = item["kind"]
            row.date = item["dt"]
            row.description = item["description"]
            row.amount = item["amount"]
            row.subtag_id = item["subtag_id"]
            row.expense_sharing_id = item["sharing_id"]
            row.ownership_percentage = _ownership_or_full(item["ownership"])
            if item.get("category"):
                row.category = item["category"]
            if item.get("transaction"):
                row.transaction = item["transaction"]
            db.flush()
            stats["bank_updated"] += 1
            if kind != "noop":
                impact = after_bank_statement_updated(
                    db, tenant_id, account_id, user_id, row,
                    kind=kind,
                    old_date=old_date,
                    note="Importação visual extrato",
                )
                closure_impact = merge_closure_impacts(closure_impact, impact) or closure_impact
        elif item["action"] == "create_bank":
            row = BankStatement(
                tenant_id=tenant_id,
                created_by=user_id,
                account_id=account_id,
                date=item["dt"],
                description=item["description"],
                amount=item["amount"],
                subtag_id=item["subtag_id"],
                expense_sharing_id=item["sharing_id"],
                ownership_percentage=_ownership_or_full(item["ownership"]),
                category=item.get("category") or None,
                transaction=item.get("transaction") or None,
            )
            db.add(row)
            db.flush()
            stats["bank_created"] += 1
            period = _period_from_date(item["dt"])
            if period and period in closed:
                seed = _downstream_closed_periods(closed, {period})
                cash_periods.update(seed)
        elif item["action"] == "update_benefit":
            row = plan["benefit_by_id"].get(int(item["id"]))
            if not row:
                issues.append({"source": "benefit", "row": item["line"], "reason": "Registro não encontrado"})
                continue
            kind = item["kind"]
            row.date = item["dt"]
            row.description = item["description"]
            row.amount = item["amount"]
            row.subtag_id = item["subtag_id"]
            row.expense_sharing_id = item["sharing_id"]
            row.ownership_percentage = _ownership_or_full(item["ownership"])
            if item.get("payment_method"):
                row.payment_method = item["payment_method"]
            db.flush()
            stats["benefit_updated"] += 1
            if kind != "noop":
                period = _period_from_date(row.date)
                if period:
                    benefit_refresh_periods.add(period)
        elif item["action"] == "create_benefit":
            if not item.get("can_create", True):
                stats["skipped"] += 1
                continue
            card_id = plan["benefit_cards"].resolve(str(item.get("card_last4") or ""))
            if not card_id:
                issues.append({
                    "source": "benefit",
                    "row": item["line"],
                    "reason": "Cartão de benefício não encontrado para criar lançamento",
                })
                stats["skipped"] += 1
                continue
            row = BenefitCardStatement(
                tenant_id=tenant_id,
                created_by=user_id,
                account_id=account_id,
                credit_card_id=card_id,
                date=item["dt"],
                description=item["description"],
                amount=item["amount"],
                subtag_id=item["subtag_id"],
                expense_sharing_id=item["sharing_id"],
                ownership_percentage=_ownership_or_full(item["ownership"]),
                payment_method=item.get("payment_method") or "Importado",
            )
            db.add(row)
            db.flush()
            stats["benefit_created"] += 1
            period = _period_from_date(item["dt"])
            if period:
                benefit_refresh_periods.add(period)

    if benefit_refresh_periods:
        refreshed = refresh_closed_snapshots_for_periods(
            db, tenant_id, account_id, benefit_refresh_periods,
        )
        if refreshed:
            impact = closure_impact_classification(
                records_updated=stats["benefit_updated"] + stats["benefit_created"],
                year_months=refreshed,
                message="Benefícios atualizados no histórico de fechamentos.",
            )
            closure_impact = merge_closure_impacts(closure_impact, impact) or closure_impact

    if cash_periods:
        dates_for_adj = [datetime(y, m, 15) for y, m in cash_periods]
        adjustment_periods: set[tuple[int, int]] = set()
        for d in dates_for_adj:
            adjustment_periods |= _cash_adjustment_periods_from_dates(d)
        recalc = apply_cash_closure_recalc(
            db,
            tenant_id,
            account_id,
            user_id,
            sorted(cash_periods),
            adjustment_periods=adjustment_periods,
            note_append="Importação visual extrato",
        )
        closure_impact = merge_closure_impacts(closure_impact, recalc) or closure_impact

    return {
        "success": True,
        "stats": stats,
        "issues": issues,
        "closure_impact": closure_impact if closure_impact.get("impact_type") != "none" else None,
    }
