# -*- coding: utf-8 -*-
"""Importação visual Excel para cadastros mestre (sem impacto em fechamentos)."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session, joinedload

from app.services.import_batch import ImportBatch
from app.models.unified_models import (
    Account,
    Bank,
    Cartao,
    CreditCardInvoiceGroup,
    ExpenseSharingSetting,
    ExpenseTemplate,
    ExpenseTemplateItem,
    Subtag,
    Tag,
)


def _empty_preview() -> dict[str, Any]:
    return {
        "summary": {
            "creates": 0,
            "updates": 0,
            "unchanged": 0,
            "skipped_invalid": 0,
            "issues": 0,
        },
        "creates": [],
        "updates": [],
        "issues": [],
    }


ISSUE_NOT_CREATED = "Não será criado"
ISSUE_IGNORED = "Linha ignorada"
ISSUE_KEEP_TAG = "Tag atual mantida"
ISSUE_NO_CLASSIFICATION = "Sem classificação"
ISSUE_NO_SHARING = "Sem compartilhamento"


def _issue_detail(parent: Any, name: Any, *, sep: str = "/") -> str | None:
    left = str(parent or "").strip()
    right = str(name or "").strip()
    if left and right:
        return f"{left}{sep}{right}"
    return left or right or None


def _finish_preview(
    creates: list,
    updates: list,
    unchanged: int,
    skipped: int,
    issues: list,
) -> dict[str, Any]:
    return {
        "summary": {
            "creates": len(creates),
            "updates": len(updates),
            "unchanged": unchanged,
            "skipped_invalid": skipped,
            "issues": len(issues),
        },
        "creates": creates,
        "updates": updates,
        "issues": issues,
    }


def _parse_subtag_type(label: str) -> Optional[str]:
    t = (label or "").strip().lower()
    if t.startswith("rec"):
        return "receita"
    if t.startswith("desp"):
        return "despesa"
    return None


def _resolve_bank_id(db: Session, code: str) -> Optional[int]:
    code = (code or "").strip()
    if not code:
        return None
    row = db.query(Bank).filter(Bank.code == code, Bank.active == True).first()
    return int(row.id) if row else None


def _bank_digits(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    digits = re.sub(r"\D", "", str(value))
    return digits if digits else None


def _account_digits_sql(column: Any) -> Any:
    """Compara agência/conta no banco (VARCHAR) com valor numérico da planilha."""
    return func.regexp_replace(cast(column, String), r"[^0-9]", "", "g")


def _resolve_partner_account(
    db: Session,
    tenant_id: int,
    *,
    partner_name: str,
    bank_code: str,
    agency: Any,
    account_number: Any,
) -> Optional[Account]:
    agency_digits = _bank_digits(agency)
    account_digits = _bank_digits(account_number)
    if bank_code and agency_digits is not None and account_digits is not None:
        bank_id = _resolve_bank_id(db, bank_code)
        if bank_id:
            row = (
                db.query(Account)
                .filter(
                    Account.tenant_id == tenant_id,
                    Account.bank_id == bank_id,
                    _account_digits_sql(Account.agency) == agency_digits,
                    _account_digits_sql(Account.account_number) == account_digits,
                    Account.active == True,
                )
                .first()
            )
            if row:
                return row
    name = (partner_name or "").strip()
    if not name:
        return None
    return (
        db.query(Account)
        .filter(
            Account.tenant_id == tenant_id,
            func.lower(Account.name) == name.lower(),
            Account.active == True,
        )
        .first()
    )


def _resolve_sharing_for_partner(
    db: Session,
    tenant_id: int,
    account_id: int,
    partner_account_id: int,
) -> Optional[int]:
    """Config direta (minha) tem prioridade; senão, a inversa criada pelo parceiro."""
    for owner_id, other_id in ((account_id, partner_account_id), (partner_account_id, account_id)):
        row = (
            db.query(ExpenseSharingSetting)
            .filter(
                ExpenseSharingSetting.tenant_id == tenant_id,
                ExpenseSharingSetting.account_id == owner_id,
                ExpenseSharingSetting.shared_account_id == other_id,
                ExpenseSharingSetting.active == True,
            )
            .first()
        )
        if row:
            return int(row.id)
    return None


def _resolve_sharing_by_partner_label(
    db: Session,
    tenant_id: int,
    account_id: int,
    partner_label: str,
) -> Optional[int]:
    """Localiza compartilhamento ativo pelo nome ou descrição da conta parceira."""
    label = (partner_label or "").strip()
    if not label:
        return None
    label_lower = label.lower()
    settings = (
        db.query(ExpenseSharingSetting)
        .options(
            joinedload(ExpenseSharingSetting.shared_account),
            joinedload(ExpenseSharingSetting.account),
        )
        .filter(
            ExpenseSharingSetting.tenant_id == tenant_id,
            or_(
                ExpenseSharingSetting.account_id == account_id,
                ExpenseSharingSetting.shared_account_id == account_id,
            ),
            ExpenseSharingSetting.active == True,
        )
        .all()
    )
    settings.sort(key=lambda s: (s.account_id != account_id, s.id))
    for setting in settings:
        partner = _sharing_counterpart(setting, account_id)
        if not partner:
            continue
        for candidate in (partner.name, partner.description):
            if candidate and str(candidate).strip().lower() == label_lower:
                return int(setting.id)
    return None


def _resolve_sharing_from_partner_name(
    db: Session,
    tenant_id: int,
    account_id: int,
    partner_name: str,
) -> tuple[Optional[int], Optional[str]]:
    partner = _resolve_partner_account(
        db,
        tenant_id,
        partner_name=partner_name,
        bank_code="",
        agency=None,
        account_number=None,
    )
    if partner:
        sid = _resolve_sharing_for_partner(db, tenant_id, account_id, partner.id)
        if sid:
            return sid, None

    sid = _resolve_sharing_by_partner_label(db, tenant_id, account_id, partner_name)
    if sid:
        return sid, None

    return None, f"Não há compartilhamento ativo com {partner_name}. Cadastre em Compartilhamentos."


def _template_subtag_label(db: Session, subtag_id: int | None) -> str:
    if not subtag_id:
        return "—"
    row = (
        db.query(Tag.name, Subtag.name)
        .join(Subtag, Subtag.tag_id == Tag.id)
        .filter(Subtag.id == subtag_id)
        .first()
    )
    if not row:
        return "—"
    return f"{row[0]}/{row[1]}" if row[0] else row[1]


def _sharing_counterpart(setting: ExpenseSharingSetting, account_id: int) -> Optional[Account]:
    return setting.account if setting.account_id != account_id else setting.shared_account


def _sharing_partner_label(db: Session, tenant_id: int, account_id: int, sharing_id: int | None) -> str:
    if not sharing_id:
        return "—"
    setting = (
        db.query(ExpenseSharingSetting)
        .options(
            joinedload(ExpenseSharingSetting.shared_account),
            joinedload(ExpenseSharingSetting.account),
        )
        .filter(ExpenseSharingSetting.id == sharing_id, ExpenseSharingSetting.tenant_id == tenant_id)
        .first()
    )
    partner = _sharing_counterpart(setting, account_id) if setting else None
    if not partner:
        return f"#{sharing_id}"
    return partner.name or f"#{sharing_id}"


def _resolve_card_expense_sharing_from_row(
    db: Session,
    tenant_id: int,
    account_id: int,
    row: dict[str, Any],
) -> tuple[Optional[int], bool, Optional[str]]:
    """
    Resolve expense_sharing_id para import de cartão.
    Retorna (sharing_id, aplicar, erro). aplicar=False mantém o valor atual do cartão.
    """
    raw_id = row.get("expense_sharing_id")
    if raw_id == 0:
        return None, True, None

    partner_name = (str(row.get("partner_name") or "")).strip()
    stale_sharing_id: int | None = None
    if raw_id not in (None, ""):
        try:
            sid = int(raw_id)
        except (TypeError, ValueError):
            return None, True, f"ID compartilhamento inválido: {raw_id}"
        setting = (
            db.query(ExpenseSharingSetting)
            .options(joinedload(ExpenseSharingSetting.shared_account), joinedload(ExpenseSharingSetting.account))
            .filter(
                ExpenseSharingSetting.id == sid,
                ExpenseSharingSetting.tenant_id == tenant_id,
                ExpenseSharingSetting.account_id == account_id,
            )
            .first()
        )
        counterpart = _sharing_counterpart(setting, account_id) if setting else None
        if setting and (not partner_name or (counterpart and _same_name(counterpart.name, partner_name))):
            return sid, True, None
        stale_sharing_id = sid

    if not partner_name:
        if stale_sharing_id is not None:
            return (
                None,
                True,
                f"Compartilhamento ID {stale_sharing_id} não existe nesta conta "
                f"(IDs mudam entre ambientes). Preencha a coluna Conta parceira.",
            )
        return None, False, None

    sid, err = _resolve_sharing_from_partner_name(db, tenant_id, account_id, partner_name)
    if err:
        if stale_sharing_id is not None:
            return None, True, f"{err} (ID {stale_sharing_id} da planilha não existe aqui.)"
        return None, True, err
    return sid, True, None


def _template_ownership(row: dict[str, Any]) -> Any:
    """Parte da conta logada; 0% é válido (gerenciado), só a ausência vira 100%."""
    value = row.get("ownership_percentage")
    return 100 if value is None or value == "" else value


def _display_val(value: Any) -> str:
    if value is None or value == "":
        return "—"
    if isinstance(value, bool):
        return "Sim" if value else "Não"
    return str(value)


def _display_agency(value: Any) -> str:
    if value is None or value == "":
        return "—"
    try:
        return str(int(value)).zfill(5)
    except (TypeError, ValueError):
        return _display_val(value)


def _display_account_number(value: Any) -> str:
    if value is None or value == "":
        return "—"
    try:
        return str(int(value)).zfill(9)
    except (TypeError, ValueError):
        return _display_val(value)


def _cmp_key(value: Any) -> str:
    if isinstance(value, bool):
        return "sim" if value else "nao"
    if value is None:
        return ""
    if isinstance(value, (int, float, Decimal)):
        try:
            return format(Decimal(str(value)).quantize(Decimal("0.01")), "f")
        except Exception:
            pass
    text = str(value).strip()
    if text in ("", "—", "None"):
        return ""
    try:
        return format(Decimal(text.replace(",", ".")).quantize(Decimal("0.01")), "f")
    except Exception:
        return text


def _append_field_change(
    changes: list[dict[str, Any]],
    field: str,
    label: str,
    before: Any,
    after: Any,
    *,
    fmt: Any | None = None,
) -> None:
    if _cmp_key(before) == _cmp_key(after):
        return
    display = fmt or _display_val
    changes.append({"field": field, "label": label, "before": display(before), "after": display(after)})


def _preview_create_row(
    line: int,
    label: str,
    *,
    record_id: int | None = None,
    entity: str | None = None,
    fields_after: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "row": line,
        "label": label,
        "record_id": record_id,
        "entity": entity,
        "fields_after": fields_after or {},
    }


def _preview_update_row(
    line: int,
    label: str,
    record_id: int | None,
    changes: list[dict[str, Any]],
    *,
    entity: str | None = None,
) -> dict[str, Any]:
    return {
        "row": line,
        "label": label,
        "record_id": record_id,
        "entity": entity,
        "changes": changes,
    }


def _bank_code(db: Session, bank_id: int | None) -> str:
    if not bank_id:
        return "—"
    row = db.query(Bank).filter(Bank.id == bank_id).first()
    return row.code if row else "—"


# ---------- Tags / Subtags ----------


class _ImportTagRef:
    """Referência a tag da planilha ainda não existente no banco (preview)."""

    __slots__ = ("id", "name")

    def __init__(self, name: str, id_: int | None = None):
        self.name = name
        self.id = id_


def _pending_tag_names_index(tags: list[dict[str, Any]]) -> dict[str, str]:
    """Nome normalizado (lower) -> nome canônico da aba Tags."""
    out: dict[str, str] = {}
    for row in tags:
        name = (row.get("name") or "").strip()
        if name:
            out[name.lower()] = name
    return out


def _find_tag_in_account_by_name(db: Session, account_id: int, name: str) -> Tag | None:
    n = (name or "").strip()
    if not n:
        return None
    return (
        db.query(Tag)
        .filter(
            Tag.account_id == account_id,
            func.lower(Tag.name) == n.lower(),
        )
        .first()
    )


def _same_name(a: str | None, b: str | None) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


def _tag_by_file_id(db: Session, tenant_id: int, account_id: int, tag_id: Any, name: str) -> Tag | None:
    """IDs da planilha podem vir de outra conta/base: só vale se o nome também bater."""
    if not tag_id:
        return None
    tag = (
        db.query(Tag)
        .filter(Tag.id == tag_id, Tag.tenant_id == tenant_id, Tag.account_id == account_id)
        .first()
    )
    return tag if tag and _same_name(tag.name, name) else None


def _subtag_by_file_id(
    db: Session, tenant_id: int, account_id: int, subtag_id: Any, name: str, stype: str | None,
) -> Subtag | None:
    if not subtag_id:
        return None
    sub = (
        db.query(Subtag)
        .filter(Subtag.id == subtag_id, Subtag.tenant_id == tenant_id, Subtag.account_id == account_id)
        .first()
    )
    if not sub or not _same_name(sub.name, name):
        return None
    if stype and sub.type != stype:
        return None
    return sub


def _tag_id_by_name_lookup(tag_id_by_name: dict[str, int], tag_name: str) -> int | None:
    n = (tag_name or "").strip()
    if not n:
        return None
    if n in tag_id_by_name:
        return tag_id_by_name[n]
    return tag_id_by_name.get(n.lower())


def _resolve_import_tag_for_subtag(
    db: Session,
    account_id: int,
    *,
    tag_id: Any,
    tag_name: str,
    pending_by_lower: dict[str, str],
    tag_id_by_name: dict[str, int] | None = None,
) -> Tag | _ImportTagRef | None:
    name_key = (tag_name or "").strip()
    by_name_db = _find_tag_in_account_by_name(db, account_id, name_key) if name_key else None
    by_id: Tag | None = None
    if tag_id:
        by_id = db.query(Tag).filter(Tag.id == tag_id, Tag.account_id == account_id).first()
        if by_id and name_key and not _same_name(by_id.name, name_key):
            by_id = None

    if by_name_db and by_id and by_name_db.id != by_id.id and name_key:
        return by_name_db
    if by_id:
        return by_id
    if by_name_db:
        return by_name_db
    if tag_id_by_name is not None and name_key:
        rid = _tag_id_by_name_lookup(tag_id_by_name, name_key)
        if rid:
            mapped = db.query(Tag).filter(Tag.id == rid, Tag.account_id == account_id).first()
            if mapped:
                return mapped
    if name_key and name_key.lower() in pending_by_lower:
        return _ImportTagRef(pending_by_lower[name_key.lower()])
    return None


def _import_tag_db_id(db: Session, account_id: int, tag: Tag | _ImportTagRef) -> int | None:
    if isinstance(tag, Tag):
        return tag.id
    if not tag.name:
        return None
    found = _find_tag_in_account_by_name(db, account_id, tag.name)
    return found.id if found else None


def preview_tags_subtags_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    *,
    tags: list[dict[str, Any]],
    subtags: list[dict[str, Any]],
) -> dict[str, Any]:
    creates: list[dict] = []
    updates: list[dict] = []
    issues: list[dict] = []
    skipped = unchanged = 0
    pending_tag_names = _pending_tag_names_index(tags)
    tag_meta: dict[str, dict[str, Any]] = {}

    def _remember_tag(name: str, status: str, icon: Any, description: Any) -> None:
        current = tag_meta.get(name.lower())
        if current and current["status"] != "unchanged":
            return
        tag_meta[name.lower()] = {
            "name": name,
            "status": status,
            "icon": icon or None,
            "description": description or None,
        }

    def _with_group(row: dict[str, Any], tag_name: str, *, name: str, subtype: str | None = None):
        row["group"] = tag_name
        row["name"] = name
        if subtype:
            row["subtype"] = subtype
        return row

    for row in tags:
        line = int(row.get("row_index") or 0)
        name = (row.get("name") or "").strip()
        if not name:
            issues.append({"row": line, "reason": "Nome da tag vazio", "action": ISSUE_IGNORED})
            skipped += 1
            continue
        existing = _tag_by_file_id(db, tenant_id, account_id, row.get("id"), name)
        if not existing:
            existing = _find_tag_in_account_by_name(db, account_id, name)
        if existing:
            changes: list[dict[str, Any]] = []
            if row.get("description") is not None:
                _append_field_change(changes, "description", "Descrição", existing.description, row.get("description"))
            if row.get("icon") is not None:
                _append_field_change(changes, "icon", "Ícone", existing.icon, row.get("icon"))
            _remember_tag(
                existing.name,
                "update" if changes else "unchanged",
                row.get("icon") or existing.icon,
                row.get("description") or existing.description,
            )
            if changes:
                updates.append(
                    _with_group(
                        _preview_update_row(line, existing.name, existing.id, changes, entity="tag"),
                        existing.name,
                        name=existing.name,
                    ),
                )
            else:
                unchanged += 1
        else:
            _remember_tag(name, "create", row.get("icon"), row.get("description"))
            creates.append(
                _with_group(
                    _preview_create_row(
                        line,
                        name,
                        entity="tag",
                        fields_after={
                            "Nome": name,
                            "Descrição": _display_val(row.get("description")),
                            "Ícone": _display_val(row.get("icon")),
                        },
                    ),
                    name,
                    name=name,
                )
            )

    for row in subtags:
        line = int(row.get("row_index") or 0)
        name = (row.get("name") or "").strip()
        stype = _parse_subtag_type(str(row.get("type") or ""))
        if not name or not stype:
            issues.append({
                "row": line,
                "reason": "Subtag exige nome e tipo",
                "detail": _issue_detail(row.get("tag_name"), name),
                "action": ISSUE_IGNORED,
            })
            skipped += 1
            continue
        tag_id = row.get("tag_id")
        tag_name = (row.get("tag_name") or "").strip()
        existing = _subtag_by_file_id(db, tenant_id, account_id, row.get("id"), name, stype)
        tag = _resolve_import_tag_for_subtag(
            db,
            account_id,
            tag_id=tag_id,
            tag_name=tag_name,
            pending_by_lower=pending_tag_names,
        )
        if not tag:
            if existing:
                issues.append({
                    "row": line,
                    "reason": (
                        f"Tag não encontrada: {tag_name or tag_id}. "
                        "Subtag existente atualizada sem alterar a tag."
                    ),
                    "detail": _issue_detail(tag_name, name),
                    "action": ISSUE_KEEP_TAG,
                })
                changes = []
                _append_field_change(changes, "description", "Descrição", existing.description, row.get("description"))
                _append_field_change(changes, "icon", "Ícone", existing.icon, row.get("icon"))
                if changes:
                    old_tag = db.query(Tag).filter(Tag.id == existing.tag_id).first()
                    old_tag_name = old_tag.name if old_tag else "—"
                    if old_tag:
                        _remember_tag(old_tag.name, "unchanged", old_tag.icon, old_tag.description)
                    updates.append(
                        _with_group(
                            _preview_update_row(
                                line, f"{old_tag_name}/{name}", existing.id, changes, entity="subtag",
                            ),
                            old_tag_name,
                            name=name,
                            subtype=stype,
                        ),
                    )
                else:
                    unchanged += 1
            else:
                issues.append({
                    "row": line,
                    "reason": (
                        f"Tag não encontrada: {tag_name or tag_id}. "
                        "Subtag nova não importada (tag é obrigatória)."
                    ),
                    "detail": _issue_detail(tag_name, name),
                    "action": ISSUE_NOT_CREATED,
                })
                skipped += 1
            continue
        lookup_tag_id = _import_tag_db_id(db, account_id, tag)
        if not existing and lookup_tag_id:
            existing = (
                db.query(Subtag)
                .filter(
                    Subtag.account_id == account_id,
                    Subtag.tag_id == lookup_tag_id,
                    Subtag.name == name,
                    Subtag.type == stype,
                )
                .first()
            )
        if isinstance(tag, Tag):
            _remember_tag(tag.name, "unchanged", tag.icon, tag.description)
        if existing:
            changes = []
            old_tag = db.query(Tag).filter(Tag.id == existing.tag_id).first()
            _append_field_change(changes, "tag", "Tag", old_tag.name if old_tag else "—", tag.name)
            _append_field_change(changes, "description", "Descrição", existing.description, row.get("description"))
            _append_field_change(changes, "icon", "Ícone", existing.icon, row.get("icon"))
            if changes:
                updates.append(
                    _with_group(
                        _preview_update_row(line, f"{tag.name}/{name}", existing.id, changes, entity="subtag"),
                        tag.name,
                        name=name,
                        subtype=stype,
                    ),
                )
            else:
                unchanged += 1
        else:
            creates.append(
                _with_group(
                    _preview_create_row(
                        line,
                        f"{tag.name}/{name}",
                        entity="subtag",
                        fields_after={
                            "Tag": tag.name,
                            "Nome": name,
                            "Tipo": stype,
                            "Descrição": _display_val(row.get("description")),
                            "Ícone": _display_val(row.get("icon")),
                        },
                    ),
                    tag.name,
                    name=name,
                    subtype=stype,
                )
            )

    preview = _finish_preview(creates, updates, unchanged, skipped, issues)
    preview["tag_groups"] = sorted(tag_meta.values(), key=lambda g: g["name"].lower())
    return preview


def apply_tags_subtags_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    *,
    tags: list[dict[str, Any]],
    subtags: list[dict[str, Any]],
) -> dict[str, Any]:
    pending_tag_names = _pending_tag_names_index(tags)
    preview = preview_tags_subtags_import(db, tenant_id, account_id, tags=tags, subtags=subtags)
    tag_id_by_name: dict[str, int] = {}

    for row in tags:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        tag = _tag_by_file_id(db, tenant_id, account_id, row.get("id"), name)
        if not tag:
            tag = _find_tag_in_account_by_name(db, account_id, name)
        if tag:
            if row.get("description") is not None:
                tag.description = row.get("description")
            if row.get("icon") is not None:
                tag.icon = row.get("icon") or None
        else:
            tag = Tag(
                account_id=account_id,
                tenant_id=tenant_id,
                created_by=user_id,
                name=name,
                description=row.get("description"),
                icon=row.get("icon"),
            )
            db.add(tag)
            db.flush()
        tag_id_by_name[name] = tag.id
        tag_id_by_name[name.lower()] = tag.id

    for row in subtags:
        name = (row.get("name") or "").strip()
        stype = _parse_subtag_type(str(row.get("type") or ""))
        if not name or not stype:
            continue
        tag_id = row.get("tag_id")
        tag_name = (row.get("tag_name") or "").strip()
        resolved = _resolve_import_tag_for_subtag(
            db,
            account_id,
            tag_id=tag_id,
            tag_name=tag_name,
            pending_by_lower=pending_tag_names,
            tag_id_by_name=tag_id_by_name,
        )
        tag = resolved if isinstance(resolved, Tag) else None
        if not tag and isinstance(resolved, _ImportTagRef):
            tag = _find_tag_in_account_by_name(db, account_id, resolved.name)
        sub = _subtag_by_file_id(db, tenant_id, account_id, row.get("id"), name, stype)
        if not tag:
            if sub:
                sub.description = row.get("description")
                sub.icon = row.get("icon") or None
            continue
        if not sub:
            sub = (
                db.query(Subtag)
                .filter(
                    Subtag.account_id == account_id,
                    Subtag.tag_id == tag.id,
                    Subtag.name == name,
                    Subtag.type == stype,
                )
                .first()
            )
        if sub:
            sub.tag_id = tag.id
            sub.description = row.get("description")
            sub.icon = row.get("icon") or None
        else:
            db.add(
                Subtag(
                    account_id=account_id,
                    tenant_id=tenant_id,
                    created_by=user_id,
                    tag_id=tag.id,
                    name=name,
                    description=row.get("description"),
                    type=stype,
                    icon=row.get("icon"),
                )
            )

    return {"message": "Tags e subtags importadas.", "stats": preview["summary"], "issues": preview["issues"]}


# ---------- Contas (user scope) ----------


def preview_contas_import(
    db: Session,
    tenant_id: int,
    user_id: int,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    creates, updates, issues = [], [], []
    skipped = unchanged = 0
    for row in rows:
        line = int(row.get("row_index") or 0)
        name = (row.get("name") or "").strip()
        if not name:
            issues.append({"row": line, "reason": "Nome vazio", "action": ISSUE_IGNORED})
            skipped += 1
            continue
        bank_code = (row.get("bank_code") or "").strip()
        if bank_code and not _resolve_bank_id(db, bank_code):
            issues.append({
                "row": line,
                "reason": f"Banco não encontrado: {bank_code}",
                "detail": name,
                "action": ISSUE_IGNORED,
            })
            skipped += 1
            continue
        cid = row.get("id")
        existing = None
        if cid:
            existing = (
                db.query(Account)
                .filter(Account.id == cid, Account.tenant_id == tenant_id, Account.user_id == user_id)
                .first()
            )
        if not existing:
            existing = (
                db.query(Account)
                .filter(Account.tenant_id == tenant_id, Account.user_id == user_id, Account.name == name)
                .first()
            )
        file_desc = row.get("description")
        file_type = row.get("account_type")
        file_agency = row.get("agency")
        file_account = row.get("account_number")
        file_active = row.get("active", True)

        if existing:
            changes = []
            _append_field_change(changes, "name", "Nome", existing.name, name)
            _append_field_change(changes, "description", "Descrição", existing.description, file_desc)
            _append_field_change(changes, "account_type", "Tipo", existing.account_type, file_type)
            _append_field_change(changes, "bank", "Banco (código)", _bank_code(db, existing.bank_id), bank_code or "—")
            _append_field_change(
                changes, "agency", "Agência", existing.agency, file_agency, fmt=_display_agency
            )
            _append_field_change(
                changes,
                "account_number",
                "Conta",
                existing.account_number,
                file_account,
                fmt=_display_account_number,
            )
            _append_field_change(changes, "active", "Ativo", existing.active, file_active)
            if changes:
                updates.append(
                    _preview_update_row(line, name, existing.id, changes, entity="conta"),
                )
            else:
                unchanged += 1
        else:
            creates.append(
                _preview_create_row(
                    line,
                    name,
                    entity="conta",
                    fields_after={
                        "Nome": name,
                        "Descrição": _display_val(file_desc),
                        "Tipo": _display_val(file_type),
                        "Banco (código)": _display_val(bank_code),
                        "Agência": _display_agency(file_agency),
                        "Conta": _display_account_number(file_account),
                        "Ativo": _display_val(file_active),
                    },
                )
            )
    return _finish_preview(creates, updates, unchanged, skipped, issues)


def apply_contas_import(db: Session, tenant_id: int, user_id: int, rows: list[dict[str, Any]]) -> dict[str, Any]:
    preview = preview_contas_import(db, tenant_id, user_id, rows)
    for row in rows:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        bank_id = _resolve_bank_id(db, str(row.get("bank_code") or ""))
        cid = row.get("id")
        acc = None
        if cid:
            acc = (
                db.query(Account)
                .filter(Account.id == cid, Account.tenant_id == tenant_id, Account.user_id == user_id)
                .first()
            )
        if not acc:
            acc = (
                db.query(Account)
                .filter(Account.tenant_id == tenant_id, Account.user_id == user_id, Account.name == name)
                .first()
            )
        fields = {
            "description": row.get("description"),
            "account_type": row.get("account_type"),
            "bank_id": bank_id,
            "agency": int(row["agency"]) if row.get("agency") is not None else None,
            "account_number": int(row["account_number"]) if row.get("account_number") is not None else None,
            "active": row.get("active", True),
        }
        if acc:
            for k, v in fields.items():
                if v is not None or k == "description":
                    setattr(acc, k, v)
            if not acc.name:
                acc.name = name
        else:
            db.add(
                Account(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    created_by=user_id,
                    name=name,
                    **fields,
                )
            )
    return {"message": "Contas importadas.", "stats": preview["summary"], "issues": preview["issues"]}


# ---------- Compartilhamentos ----------


class _PendingAccount:
    """Conta que virá de outra planilha da mesma leva, ainda ausente no banco."""

    def __init__(self, name: str):
        self.id = None
        self.name = name


def _resolve_compartilhamento_partner(
    db: Session,
    tenant_id: int,
    account_id: int,
    row: dict[str, Any],
    batch: ImportBatch | None = None,
) -> tuple[Optional[Account | _PendingAccount], Optional[str]]:
    raw_partner_id = row.get("shared_account_id")
    if raw_partner_id not in (None, "", 0):
        try:
            partner_id = int(raw_partner_id)
        except (TypeError, ValueError):
            return None, f"ID conta parceira inválido: {raw_partner_id}"
        if partner_id == account_id:
            return None, "Não é possível compartilhar com a própria conta"
        partner = (
            db.query(Account)
            .filter(
                Account.id == partner_id,
                Account.tenant_id == tenant_id,
                Account.active == True,
            )
            .first()
        )
        if partner:
            return partner, None

    partner = _resolve_partner_account(
        db,
        tenant_id,
        partner_name=str(row.get("partner_name") or ""),
        bank_code=str(row.get("bank_code") or ""),
        agency=row.get("agency"),
        account_number=row.get("account_number"),
    )
    if not partner:
        partner_name = str(row.get("partner_name") or "").strip()
        if batch and partner_name and batch.has_account(partner_name):
            return _PendingAccount(partner_name), None
        return None, "Conta parceira não encontrada"
    if partner.id == account_id:
        return None, "Não é possível compartilhar com a própria conta"
    return partner, None


def preview_compartilhamentos_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    rows: list[dict[str, Any]],
    batch: ImportBatch | None = None,
) -> dict[str, Any]:
    creates, updates, issues = [], [], []
    skipped = unchanged = 0
    for row in rows:
        line = int(row.get("row_index") or 0)
        partner, partner_err = _resolve_compartilhamento_partner(
            db, tenant_id, account_id, row, batch,
        )
        if partner_err or not partner:
            issues.append({
                "row": line,
                "reason": partner_err or "Conta parceira não encontrada",
                "detail": str(row.get("partner_name") or "").strip() or None,
                "action": ISSUE_IGNORED,
            })
            skipped += 1
            continue
        rid = row.get("id")
        existing = None
        if rid:
            existing = (
                db.query(ExpenseSharingSetting)
                .filter(
                    ExpenseSharingSetting.id == rid,
                    ExpenseSharingSetting.account_id == account_id,
                )
                .first()
            )
        if not existing and partner.id is not None:
            existing = (
                db.query(ExpenseSharingSetting)
                .filter(
                    ExpenseSharingSetting.account_id == account_id,
                    ExpenseSharingSetting.shared_account_id == partner.id,
                )
                .first()
            )
        my_pct = row.get("my_contribution_percentage")
        rev_pct = row.get("revenue_contribution_percentage")
        if existing:
            changes = []
            if my_pct is not None:
                _append_field_change(
                    changes,
                    "my_pct",
                    "Contribuição despesa (%)",
                    float(existing.my_contribution_percentage),
                    float(my_pct),
                )
            if rev_pct is not None:
                _append_field_change(
                    changes,
                    "rev_pct",
                    "Contribuição receita (%)",
                    float(existing.revenue_contribution_percentage or 0),
                    float(rev_pct),
                )
            _append_field_change(changes, "description", "Descrição", existing.description, row.get("description"))
            _append_field_change(changes, "active", "Ativo", existing.active, row.get("active", True))
            if changes:
                updates.append(
                    _preview_update_row(
                        line,
                        partner.name or str(partner.id),
                        existing.id,
                        changes,
                        entity="compartilhamento",
                    ),
                )
            else:
                unchanged += 1
        else:
            creates.append(
                _preview_create_row(
                    line,
                    partner.name or str(partner.id),
                    entity="compartilhamento",
                    fields_after={
                        "Conta parceira": partner.name or str(partner.id),
                        "Contribuição despesa (%)": _display_val(my_pct if my_pct is not None else 50),
                        "Contribuição receita (%)": _display_val(rev_pct if rev_pct is not None else my_pct or 50),
                        "Descrição": _display_val(row.get("description")),
                        "Ativo": _display_val(row.get("active", True)),
                    },
                )
            )
    return _finish_preview(creates, updates, unchanged, skipped, issues)


def apply_compartilhamentos_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    preview = preview_compartilhamentos_import(db, tenant_id, account_id, rows)
    for row in rows:
        partner, partner_err = _resolve_compartilhamento_partner(db, tenant_id, account_id, row)
        if partner_err or not partner:
            continue
        rid = row.get("id")
        setting = None
        if rid:
            setting = (
                db.query(ExpenseSharingSetting)
                .filter(ExpenseSharingSetting.id == rid, ExpenseSharingSetting.account_id == account_id)
                .first()
            )
        if not setting:
            setting = (
                db.query(ExpenseSharingSetting)
                .filter(
                    ExpenseSharingSetting.account_id == account_id,
                    ExpenseSharingSetting.shared_account_id == partner.id,
                )
                .first()
            )
        raw_my = row.get("my_contribution_percentage")
        raw_rev = row.get("revenue_contribution_percentage")
        if setting:
            if raw_my is not None:
                setting.my_contribution_percentage = Decimal(str(raw_my))
            if raw_rev is not None:
                setting.revenue_contribution_percentage = Decimal(str(raw_rev))
            setting.description = row.get("description")
            setting.active = row.get("active", True)
        else:
            create_my = Decimal(str(raw_my if raw_my is not None else 50))
            create_rev = Decimal(str(raw_rev if raw_rev is not None else create_my))
            db.add(
                ExpenseSharingSetting(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    shared_account_id=partner.id,
                    created_by=user_id,
                    my_contribution_percentage=create_my,
                    revenue_contribution_percentage=create_rev,
                    description=row.get("description"),
                    active=row.get("active", True),
                )
            )
    return {"message": "Compartilhamentos importados.", "stats": preview["summary"], "issues": preview["issues"]}


# ---------- Templates (simplificado: cabeçalho + itens upsert) ----------


def _resolve_subtag(
    db: Session,
    tenant_id: int,
    account_id: int,
    tag_name: str,
    subtag_name: str,
    stype: str,
) -> Optional[int]:
    if not subtag_name or not stype:
        return None
    q = (
        db.query(Subtag)
        .join(Tag, Tag.id == Subtag.tag_id)
        .filter(
            Subtag.tenant_id == tenant_id,
            Tag.account_id == account_id,
            func.lower(Subtag.name) == subtag_name.lower(),
            Subtag.type == stype,
        )
    )
    if tag_name:
        q = q.filter(func.lower(Tag.name) == tag_name.lower())
    row = q.first()
    return int(row.id) if row else None


def _template_by_file(
    db: Session, tenant_id: int, account_id: int, template_id: Any, name: str,
) -> ExpenseTemplate | None:
    """ID da planilha só vale se o nome bater (ou se a linha não trouxer nome)."""
    base = db.query(ExpenseTemplate).filter(
        ExpenseTemplate.tenant_id == tenant_id,
        ExpenseTemplate.account_id == account_id,
    )
    if template_id:
        tpl = base.filter(ExpenseTemplate.id == template_id).first()
        if tpl and (not name or _same_name(tpl.name, name)):
            return tpl
    if name:
        return base.filter(ExpenseTemplate.name == name).first()
    return None


def preview_templates_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    *,
    templates: list[dict[str, Any]],
    items: list[dict[str, Any]],
    batch: ImportBatch | None = None,
) -> dict[str, Any]:
    creates, updates, issues = [], [], []
    skipped = unchanged = 0
    tpl_meta: dict[str, dict[str, Any]] = {}

    def _remember_template(name: str, status: str, icon: Any, description: Any) -> None:
        current = tpl_meta.get(name.lower())
        if current and current["status"] != "unchanged":
            return
        tpl_meta[name.lower()] = {
            "name": name,
            "status": status,
            "icon": icon or None,
            "description": description or None,
        }

    for row in templates:
        line = int(row.get("row_index") or 0)
        name = (row.get("name") or "").strip()
        if not name:
            issues.append({"row": line, "reason": "Nome do template vazio", "action": ISSUE_IGNORED})
            skipped += 1
            continue
        existing = _template_by_file(db, tenant_id, account_id, row.get("id"), name)
        if existing:
            changes = []
            _append_field_change(changes, "description", "Descrição", existing.description, row.get("description"))
            if row.get("icon"):
                _append_field_change(changes, "icon", "Ícone", existing.icon, row.get("icon"))
            _append_field_change(changes, "active", "Ativo", existing.active, row.get("active", True))
            _remember_template(
                existing.name,
                "update" if changes else "unchanged",
                row.get("icon") or existing.icon,
                row.get("description"),
            )
            if changes:
                update_row = _preview_update_row(line, existing.name, existing.id, changes, entity="template")
                update_row["group"] = existing.name
                updates.append(update_row)
            else:
                unchanged += 1
        else:
            _remember_template(name, "create", row.get("icon") or "FileText", row.get("description"))
            create_row = _preview_create_row(
                line,
                name,
                entity="template",
                fields_after={
                    "Nome": name,
                    "Descrição": _display_val(row.get("description")),
                    "Ícone": _display_val(row.get("icon")),
                    "Ativo": _display_val(row.get("active", True)),
                },
            )
            create_row["group"] = name
            creates.append(create_row)

    for row in items:
        line = int(row.get("row_index") or 0)
        desc = (row.get("description") or "").strip()
        if not desc:
            issues.append({
                "row": line,
                "reason": "Descrição do item vazia",
                "detail": str(row.get("template_name") or "").strip() or None,
                "action": ISSUE_IGNORED,
            })
            skipped += 1
            continue
        item_detail = _issue_detail(row.get("template_name"), desc, sep=" · ")
        stype = _parse_subtag_type(str(row.get("subtag_type") or ""))
        if row.get("subtag_name") and not stype:
            issues.append({
                "row": line,
                "reason": "Tipo inválido no item",
                "detail": item_detail,
                "action": ISSUE_IGNORED,
            })
            skipped += 1
            continue
        subtag_label = "—"
        sid: int | None = None
        if row.get("subtag_name") and stype:
            sid = _resolve_subtag(
                db,
                tenant_id,
                account_id,
                str(row.get("tag_name") or ""),
                str(row.get("subtag_name") or ""),
                stype,
            )
            if not sid and not (
                batch and batch.has_subtag(str(row.get("tag_name") or ""), str(row.get("subtag_name") or ""), stype)
            ):
                issues.append({
                    "row": line,
                    "reason": "Subtag não encontrada; item importado sem classificação.",
                    "detail": item_detail,
                    "action": ISSUE_NO_CLASSIFICATION,
                })
            else:
                tag_part = str(row.get("tag_name") or "").strip()
                subtag_label = f"{tag_part}/{row.get('subtag_name')}" if tag_part else str(row.get("subtag_name"))

        sharing_label = "—"
        sharing_id_preview: int | None = None
        partner_name = str(row.get("partner_name") or "").strip()
        if partner_name:
            partner = _resolve_partner_account(
                db,
                tenant_id,
                partner_name=partner_name,
                bank_code="",
                agency=None,
                account_number=None,
            )
            sharing_id_preview = (
                _resolve_sharing_for_partner(db, tenant_id, account_id, partner.id)
                if partner
                else None
            )
            if not sharing_id_preview and not (batch and batch.has_sharing(partner_name)):
                issues.append({
                    "row": line,
                    "reason": (
                        f"Compartilhamento não encontrado ({partner_name}); "
                        "item importado sem compartilhamento."
                    ),
                    "detail": item_detail,
                    "action": ISSUE_NO_SHARING,
                })
            elif sharing_id_preview:
                sharing_label = _sharing_partner_label(db, tenant_id, account_id, sharing_id_preview)
            else:
                sharing_label = partner_name

        file_tpl_name = (row.get("template_name") or "").strip()
        tpl = _template_by_file(db, tenant_id, account_id, row.get("template_id"), file_tpl_name)
        tpl_name = tpl.name if tpl else (file_tpl_name or f"Template #{row.get('template_id')}")
        if tpl:
            _remember_template(tpl.name, "unchanged", tpl.icon, tpl.description)
        item_id = row.get("item_id")
        existing_item = None
        if item_id and tpl:
            existing_item = (
                db.query(ExpenseTemplateItem)
                .filter(
                    ExpenseTemplateItem.id == item_id,
                    ExpenseTemplateItem.expense_template_id == tpl.id,
                    ExpenseTemplateItem.tenant_id == tenant_id,
                    ExpenseTemplateItem.account_id == account_id,
                )
                .first()
            )
        label = f"{tpl_name} · {desc[:40]}"
        if existing_item:
            changes = []
            _append_field_change(changes, "description", "Descrição", existing_item.description, desc)
            _append_field_change(changes, "amount", "Valor", existing_item.amount, row.get("amount"))
            _append_field_change(changes, "day", "Dia", existing_item.day_of_month, row.get("day_of_month"))
            _append_field_change(
                changes, "ownership", "Parte (%)", existing_item.ownership_percentage, _template_ownership(row),
            )
            _append_field_change(
                changes, "order", "Ordem", existing_item.display_order, row.get("display_order") or 0,
            )
            before_subtag = _template_subtag_label(db, existing_item.subtag_id)
            same_subtag_name = subtag_label != "—" and before_subtag.casefold() == subtag_label.casefold()
            if not same_subtag_name and (existing_item.subtag_id or None) != (sid or None):
                _append_field_change(changes, "subtag", "Tag/Subtag", before_subtag, subtag_label)
            before_sharing = _sharing_partner_label(db, tenant_id, account_id, existing_item.expense_sharing_id)
            same_sharing_name = sharing_label != "—" and before_sharing.casefold() == sharing_label.casefold()
            if not same_sharing_name and (existing_item.expense_sharing_id or None) != (sharing_id_preview or None):
                _append_field_change(changes, "sharing", "Compartilhamento", before_sharing, sharing_label)
            if changes:
                update_row = _preview_update_row(line, label, existing_item.id, changes, entity="template_item")
                update_row["group"] = tpl_name
                update_row["name"] = desc
                updates.append(update_row)
            else:
                unchanged += 1
        else:
            create_row = _preview_create_row(
                line,
                label,
                entity="template_item",
                fields_after={
                    "Template": tpl_name,
                    "Descrição": desc,
                    "Valor": _display_val(row.get("amount")),
                    "Dia": _display_val(row.get("day_of_month")),
                    "Classificação": subtag_label,
                    "Compartilhamento": sharing_label,
                    "Parte (%)": _display_val(_template_ownership(row)),
                },
            )
            create_row["group"] = tpl_name
            create_row["name"] = desc
            creates.append(create_row)
    preview = _finish_preview(creates, updates, unchanged, skipped, issues)
    preview["template_groups"] = sorted(tpl_meta.values(), key=lambda g: g["name"].lower())
    return preview


def apply_templates_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    *,
    templates: list[dict[str, Any]],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    preview = preview_templates_import(
        db, tenant_id, account_id, templates=templates, items=items,
    )
    tpl_by_name: dict[str, ExpenseTemplate] = {}
    for row in templates:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        tpl = _template_by_file(db, tenant_id, account_id, row.get("id"), name)
        if tpl:
            tpl.description = row.get("description")
            tpl.icon = row.get("icon") or tpl.icon
            tpl.active = row.get("active", True)
        else:
            tpl = ExpenseTemplate(
                tenant_id=tenant_id,
                account_id=account_id,
                created_by=user_id,
                name=name,
                description=row.get("description"),
                icon=row.get("icon") or "FileText",
                active=row.get("active", True),
            )
            db.add(tpl)
            db.flush()
        tpl_by_name[name] = tpl

    for row in items:
        desc = (row.get("description") or "").strip()
        if not desc:
            continue
        tpl_name = (row.get("template_name") or "").strip()
        tpl = tpl_by_name.get(tpl_name) if tpl_name else None
        if not tpl:
            tpl = _template_by_file(db, tenant_id, account_id, row.get("template_id"), tpl_name)
        if not tpl:
            continue
        stype = _parse_subtag_type(str(row.get("subtag_type") or ""))
        subtag_id = None
        if row.get("subtag_name") and stype:
            subtag_id = _resolve_subtag(
                db,
                tenant_id,
                account_id,
                str(row.get("tag_name") or ""),
                str(row.get("subtag_name") or ""),
                stype,
            )
        sharing_id = None
        if row.get("partner_name"):
            partner = _resolve_partner_account(
                db,
                tenant_id,
                partner_name=str(row.get("partner_name") or ""),
                bank_code="",
                agency=None,
                account_number=None,
            )
            if partner:
                sharing_id = _resolve_sharing_for_partner(db, tenant_id, account_id, partner.id)

        item_id = row.get("item_id")
        item = None
        if item_id:
            item = (
                db.query(ExpenseTemplateItem)
                .filter(
                    ExpenseTemplateItem.id == item_id,
                    ExpenseTemplateItem.expense_template_id == tpl.id,
                )
                .first()
            )
        if item:
            item.description = desc
            item.amount = Decimal(str(row["amount"])) if row.get("amount") is not None else None
            item.day_of_month = row.get("day_of_month")
            item.subtag_id = subtag_id
            item.expense_sharing_id = sharing_id
            item.ownership_percentage = Decimal(str(_template_ownership(row)))
            item.display_order = int(row.get("display_order") or 0)
        else:
            db.add(
                ExpenseTemplateItem(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    created_by=user_id,
                    expense_template_id=tpl.id,
                    description=desc,
                    amount=Decimal(str(row["amount"])) if row.get("amount") is not None else None,
                    day_of_month=row.get("day_of_month"),
                    subtag_id=subtag_id,
                    expense_sharing_id=sharing_id,
                    ownership_percentage=Decimal(str(_template_ownership(row))),
                    display_order=int(row.get("display_order") or 0),
                )
            )
    return {"message": "Templates importados.", "stats": preview["summary"], "issues": preview["issues"]}


# ---------- Cartões / Grupos ----------


def _parse_card_type(label: str) -> str:
    t = (label or "").strip().lower()
    return "beneficios" if "benef" in t else "credito"


def _resolve_invoice_group(
    db: Session,
    account_id: int,
    *,
    group_id: int | None,
    group_name: str,
    group_by_name: dict[str, CreditCardInvoiceGroup],
) -> CreditCardInvoiceGroup | None:
    """Pelo nome do grupo; o ID da planilha só é usado sem nome (IDs mudam entre ambientes)."""
    name = (group_name or "").strip()
    if name:
        if name in group_by_name:
            return group_by_name[name]
        return (
            db.query(CreditCardInvoiceGroup)
            .filter(
                CreditCardInvoiceGroup.account_id == account_id,
                CreditCardInvoiceGroup.name == name,
            )
            .first()
        )
    if not group_id:
        return None
    return (
        db.query(CreditCardInvoiceGroup)
        .filter(
            CreditCardInvoiceGroup.id == group_id,
            CreditCardInvoiceGroup.account_id == account_id,
        )
        .first()
    )


def _import_set_group_cards(
    db: Session,
    tenant_id: int,
    account_id: int,
    group: CreditCardInvoiceGroup,
    card_ids: list[int],
) -> None:
    from app.utils.card_invoice_calendar import apply_group_calendar_to_card

    group_id = group.id
    unique_ids = list(dict.fromkeys(card_ids))
    if not unique_ids:
        return

    cards = (
        db.query(Cartao)
        .filter(
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            Cartao.id.in_(unique_ids),
            Cartao.type == "credito",
        )
        .all()
    )
    found_ids = {c.id for c in cards}
    if len(found_ids) != len(unique_ids):
        return

    db.query(Cartao).filter(
        Cartao.tenant_id == tenant_id,
        Cartao.account_id == account_id,
        Cartao.invoice_group_id == group_id,
        ~Cartao.id.in_(unique_ids),
    ).update({Cartao.invoice_group_id: None}, synchronize_session=False)

    for card in cards:
        card.invoice_group_id = group_id
        apply_group_calendar_to_card(card, group)


def _card_final(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[-4:] if len(digits) >= 4 else digits


def _account_cards(db: Session, tenant_id: int, account_id: int) -> list[Cartao]:
    return (
        db.query(Cartao)
        .filter(Cartao.tenant_id == tenant_id, Cartao.account_id == account_id)
        .order_by(Cartao.id)
        .all()
    )


def _match_existing_card(account_cards: list[Cartao], row: dict[str, Any]) -> Cartao | None:
    """IDs mudam entre ambientes: o ID da planilha só vale se o final bater; senão casa pelo final (e nome)."""
    final = _card_final(row.get("number"))
    name = (row.get("name") or "").strip()
    cid = row.get("id")
    if cid:
        by_id = next((c for c in account_cards if c.id == cid), None)
        if by_id and _card_final(by_id.number) == final:
            return by_id
    if not final:
        return None
    candidates = [c for c in account_cards if _card_final(c.number) == final]
    if len(candidates) > 1:
        candidates = [c for c in candidates if _same_name(c.name, name)] or candidates
    return candidates[0] if candidates else None


def _match_existing_group(query: Any, row: dict[str, Any]) -> CreditCardInvoiceGroup | None:
    """O ID da planilha só vale se o nome bater (IDs mudam entre ambientes)."""
    name = (row.get("name") or "").strip()
    gid = row.get("id")
    if gid:
        by_id = query.filter(CreditCardInvoiceGroup.id == gid).first()
        if by_id and _same_name(by_id.name, name):
            return by_id
    return query.filter(CreditCardInvoiceGroup.name == name).first() if name else None


def _file_card_id_map(account_cards: list[Cartao], cards: list[dict[str, Any]]) -> dict[int, int]:
    """ID do cartão na planilha → ID do cartão correspondente nesta conta."""
    mapping: dict[int, int] = {}
    for row in cards:
        file_id = row.get("id")
        if not file_id:
            continue
        match = _match_existing_card(account_cards, row)
        if match:
            mapping[int(file_id)] = int(match.id)
    return mapping


def _translate_card_ids(raw_ids: Any, id_map: dict[int, int]) -> list[int]:
    if not isinstance(raw_ids, list):
        return []
    return sorted({id_map[int(x)] for x in raw_ids if int(x) in id_map})


def preview_cartoes_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    *,
    groups: list[dict[str, Any]],
    cards: list[dict[str, Any]],
    batch: ImportBatch | None = None,
) -> dict[str, Any]:
    creates, updates, issues = [], [], []
    skipped = unchanged = 0
    group_meta: dict[str, dict[str, Any]] = {}

    def _group_query():
        return db.query(CreditCardInvoiceGroup).filter(
            CreditCardInvoiceGroup.tenant_id == tenant_id,
            CreditCardInvoiceGroup.account_id == account_id,
        )

    def _card_names(ids: list[int]) -> str:
        if not ids:
            return "—"
        rows = (
            db.query(Cartao)
            .filter(Cartao.tenant_id == tenant_id, Cartao.account_id == account_id, Cartao.id.in_(ids))
            .order_by(Cartao.name)
            .all()
        )
        return ", ".join(f"{c.name} · {c.number}" for c in rows) or "—"

    account_cards = _account_cards(db, tenant_id, account_id)
    card_id_map = _file_card_id_map(account_cards, cards)

    for row in groups:
        line = int(row.get("row_index") or 0)
        name = (row.get("name") or "").strip()
        if not name:
            continue
        existing = _match_existing_group(_group_query(), row)
        card_ids = _translate_card_ids(row.get("card_ids"), card_id_map)
        if existing:
            changes = []
            _append_field_change(changes, "closing", "Fechamento", existing.closing_day, row.get("closing_day"))
            _append_field_change(changes, "due", "Vencimento", existing.due_day, row.get("due_day"))
            _append_field_change(changes, "active", "Ativo", existing.active, row.get("active", True))
            if card_ids:
                current_ids = sorted(
                    c.id
                    for c in db.query(Cartao.id).filter(
                        Cartao.tenant_id == tenant_id,
                        Cartao.account_id == account_id,
                        Cartao.invoice_group_id == existing.id,
                    )
                )
                if current_ids != card_ids:
                    changes.append({
                        "field": "card_ids",
                        "label": "Cartões",
                        "before": _card_names(current_ids),
                        "after": _card_names(card_ids),
                    })
            group_meta[name] = {
                "name": name,
                "status": "update" if changes else "unchanged",
                "closing_day": row.get("closing_day") or existing.closing_day,
                "due_day": row.get("due_day") or existing.due_day,
            }
            if changes:
                update_row = _preview_update_row(line, name, existing.id, changes, entity="grupo_fatura")
                update_row["group"] = name
                updates.append(update_row)
            else:
                unchanged += 1
        else:
            group_meta[name] = {
                "name": name,
                "status": "create",
                "closing_day": row.get("closing_day") or 14,
                "due_day": row.get("due_day") or 14,
            }
            create_row = _preview_create_row(
                line,
                name,
                entity="grupo_fatura",
                fields_after={
                    "Nome": name,
                    "Fechamento": _display_val(row.get("closing_day")),
                    "Vencimento": _display_val(row.get("due_day")),
                    "Cartões": _card_names(card_ids),
                    "Ativo": _display_val(row.get("active", True)),
                },
            )
            create_row["group"] = name
            creates.append(create_row)

    for row in cards:
        line = int(row.get("row_index") or 0)
        name = (row.get("name") or "").strip()
        number = (row.get("number") or "").strip()
        if not name or not number:
            issues.append({
                "row": line,
                "reason": "Cartão exige nome e final",
                "detail": name or number or None,
                "action": ISSUE_IGNORED,
            })
            skipped += 1
            continue
        existing = _match_existing_card(account_cards, row)
        gname = (row.get("group_name") or "").strip()
        grp_label = gname or (str(row.get("group_id")) if row.get("group_id") else "—")
        target_group: str | None = None
        if gname and gname in group_meta:
            target_group = gname
        else:
            target = None
            if gname:
                target = _group_query().filter(CreditCardInvoiceGroup.name == gname).first()
            elif row.get("group_id"):
                target = _group_query().filter(CreditCardInvoiceGroup.id == row.get("group_id")).first()
            if target:
                target_group = target.name
                group_meta.setdefault(target.name, {
                    "name": target.name,
                    "status": "unchanged",
                    "closing_day": target.closing_day,
                    "due_day": target.due_day,
                })
        sharing_id, apply_sharing, share_err = _resolve_card_expense_sharing_from_row(
            db, tenant_id, account_id, row,
        )
        partner_label = str(row.get("partner_name") or "").strip()
        if share_err and not (batch and partner_label and batch.has_sharing(partner_label)):
            issues.append({
                "row": line,
                "reason": f"{share_err} Cartão importado sem compartilhamento.",
                "detail": f"{name} · {number}",
                "action": ISSUE_NO_SHARING,
            })
            sharing_id = None
            apply_sharing = True
        if existing:
            old_grp = "—"
            if existing.invoice_group_id:
                grp_row = (
                    db.query(CreditCardInvoiceGroup)
                    .filter(CreditCardInvoiceGroup.id == existing.invoice_group_id)
                    .first()
                )
                old_grp = grp_row.name if grp_row else "—"
            changes = []
            _append_field_change(changes, "name", "Nome", existing.name, name)
            _append_field_change(changes, "description", "Descrição", existing.description, row.get("description"))
            _append_field_change(changes, "closing", "Fechamento", existing.closing_day, row.get("closing_day"))
            _append_field_change(changes, "due", "Vencimento", existing.due_day, row.get("due_day"))
            _append_field_change(changes, "group", "Grupo", old_grp, grp_label)
            if apply_sharing:
                _append_field_change(
                    changes,
                    "sharing",
                    "Compartilhamento",
                    _sharing_partner_label(db, tenant_id, account_id, existing.expense_sharing_id),
                    _sharing_partner_label(db, tenant_id, account_id, sharing_id),
                )
            if row.get("expense_ownership_percentage") is not None:
                _append_field_change(
                    changes,
                    "exp_pct",
                    "Parte despesa (%)",
                    existing.expense_ownership_percentage,
                    row.get("expense_ownership_percentage"),
                )
            if row.get("revenue_ownership_percentage") is not None:
                _append_field_change(
                    changes,
                    "rev_pct",
                    "Parte receita (%)",
                    existing.revenue_ownership_percentage,
                    row.get("revenue_ownership_percentage"),
                )
            _append_field_change(changes, "active", "Ativo", existing.active, row.get("active", True))
            if changes:
                update_row = _preview_update_row(line, f"{name} · {number}", existing.id, changes, entity="cartao")
                update_row["group"] = target_group
                updates.append(update_row)
            else:
                unchanged += 1
        else:
            share_label = _sharing_partner_label(db, tenant_id, account_id, sharing_id) if apply_sharing else "—"
            create_row = _preview_create_row(
                line,
                f"{name} · {number}",
                entity="cartao",
                fields_after={
                    "Nome": name,
                    "Final": number,
                    "Tipo": _parse_card_type(str(row.get("type") or "")),
                    "Grupo": grp_label,
                    "Compartilhamento": share_label,
                    "Parte despesa (%)": _display_val(row.get("expense_ownership_percentage")),
                    "Parte receita (%)": _display_val(row.get("revenue_ownership_percentage")),
                    "Fechamento": _display_val(row.get("closing_day")),
                    "Vencimento": _display_val(row.get("due_day")),
                    "Ativo": _display_val(row.get("active", True)),
                },
            )
            create_row["group"] = target_group
            creates.append(create_row)
    preview = _finish_preview(creates, updates, unchanged, skipped, issues)
    preview["card_groups"] = sorted(group_meta.values(), key=lambda g: g["name"].lower())
    return preview


def apply_cartoes_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    *,
    groups: list[dict[str, Any]],
    cards: list[dict[str, Any]],
) -> dict[str, Any]:
    preview = preview_cartoes_import(
        db, tenant_id, account_id, groups=groups, cards=cards,
    )
    group_by_name: dict[str, CreditCardInvoiceGroup] = {}
    group_members_from_sheet: list[tuple[CreditCardInvoiceGroup, list[int]]] = []
    group_query = db.query(CreditCardInvoiceGroup).filter(
        CreditCardInvoiceGroup.tenant_id == tenant_id,
        CreditCardInvoiceGroup.account_id == account_id,
    )
    account_cards = _account_cards(db, tenant_id, account_id)
    sheet_cards: dict[int, Cartao] = {}

    for row in groups:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        grp = _match_existing_group(group_query, row)
        if grp:
            grp.closing_day = int(row.get("closing_day") or 14)
            grp.due_day = int(row.get("due_day") or 14)
            grp.active = row.get("active", True)
        else:
            grp = CreditCardInvoiceGroup(
                tenant_id=tenant_id,
                account_id=account_id,
                created_by=user_id,
                name=name,
                closing_day=int(row.get("closing_day") or 14),
                due_day=int(row.get("due_day") or 14),
                active=row.get("active", True),
            )
            db.add(grp)
            db.flush()
        group_by_name[name] = grp
        raw_ids = row.get("card_ids") or []
        if isinstance(raw_ids, list) and raw_ids:
            group_members_from_sheet.append((grp, [int(x) for x in raw_ids]))

    for row in cards:
        name = (row.get("name") or "").strip()
        number = (row.get("number") or "").strip()
        if not name or not number:
            continue
        ctype = _parse_card_type(str(row.get("type") or ""))
        sharing_id, apply_sharing, share_err = _resolve_card_expense_sharing_from_row(
            db, tenant_id, account_id, row,
        )
        if share_err:
            sharing_id = None
            apply_sharing = True

        grp = _resolve_invoice_group(
            db,
            account_id,
            group_id=row.get("group_id"),
            group_name=str(row.get("group_name") or ""),
            group_by_name=group_by_name,
        )
        group_id = grp.id if grp else None

        card = _match_existing_card(account_cards, row)
        closing = int(row["closing_day"]) if row.get("closing_day") is not None else 14
        due = int(row["due_day"]) if row.get("due_day") is not None else 14
        if card:
            card.name = name
            card.description = row.get("description")
            card.type = ctype
            card.closing_day = closing
            card.due_day = due
            if apply_sharing:
                card.expense_sharing_id = sharing_id
            if row.get("expense_ownership_percentage") is not None:
                card.expense_ownership_percentage = row.get("expense_ownership_percentage")
            if row.get("revenue_ownership_percentage") is not None:
                card.revenue_ownership_percentage = row.get("revenue_ownership_percentage")
            card.invoice_group_id = group_id
            card.active = row.get("active", True)
        else:
            card = Cartao(
                tenant_id=tenant_id,
                account_id=account_id,
                created_by=user_id,
                name=name,
                description=row.get("description"),
                number=number,
                type=ctype,
                closing_day=closing,
                due_day=due,
                expense_sharing_id=sharing_id if apply_sharing else None,
                expense_ownership_percentage=row.get("expense_ownership_percentage"),
                revenue_ownership_percentage=row.get("revenue_ownership_percentage"),
                invoice_group_id=group_id,
                active=row.get("active", True),
            )
            db.add(card)
            account_cards.append(card)
        if row.get("id"):
            sheet_cards[int(row["id"])] = card

    db.flush()
    card_id_map = {file_id: int(card.id) for file_id, card in sheet_cards.items()}
    group_members_from_sheet = [
        (grp, _translate_card_ids(member_ids, card_id_map)) for grp, member_ids in group_members_from_sheet
    ]
    for grp, member_ids in group_members_from_sheet:
        if len(member_ids) >= 2:
            _import_set_group_cards(db, tenant_id, account_id, grp, member_ids)
        elif len(member_ids) == 1:
            only = (
                db.query(Cartao)
                .filter(
                    Cartao.id == member_ids[0],
                    Cartao.tenant_id == tenant_id,
                    Cartao.account_id == account_id,
                    Cartao.type == "credito",
                )
                .first()
            )
            if only:
                only.invoice_group_id = grp.id
                from app.utils.card_invoice_calendar import apply_group_calendar_to_card

                apply_group_calendar_to_card(only, grp)

    return {"message": "Cartões importados.", "stats": preview["summary"], "issues": preview["issues"]}
