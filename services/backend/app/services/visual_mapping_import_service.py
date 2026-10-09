# -*- coding: utf-8 -*-
"""Importação visual de mapeamentos a partir do Excel exportado pelo Plumo."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.unified_models import ExpenseSharingSetting, Subtag, Tag, TransactionMapping
from app.services.import_batch import ImportBatch
from app.services.account_period_closure_service import AccountPeriodClosedError
from app.services.closed_period_edit_service import (
    closure_impact_none,
    ensure_mapping_remap_allowed,
    finalize_mapping_remap_closures,
    merge_closure_impacts,
)
from app.services.mapping_remap_service import apply_mapping_remap, sort_mappings_for_remap
from app.services.visual_extrato_import_service import (
    _normalize_text,
    _parse_amount,
    _resolve_sharing,
    _sharing_label,
    _subtag_label,
)
from app.utils.sensitive_mapping import decrypt_field

SENSITIVE_MASK = "(conteúdo sensível)"

_MATCH_FROM_LABEL = {
    "exato": "exact",
    "padrão": "pattern",
    "padrao": "pattern",
    "regex": "regex",
}

_PRIORITY_FROM_LABEL = {
    "alta": 0,
    "média": 1,
    "media": 1,
    "baixa": 2,
}


def _parse_match_type(label: str) -> Optional[str]:
    key = _normalize_text(label).lower()
    return _MATCH_FROM_LABEL.get(key)


def _parse_priority(label: Any) -> Optional[int]:
    if label is None or label == "":
        return None
    if isinstance(label, (int, float)) and not isinstance(label, bool):
        n = int(label)
        if 0 <= n <= 2:
            return n
    text = _normalize_text(label).lower()
    if text in _PRIORITY_FROM_LABEL:
        return _PRIORITY_FROM_LABEL[text]
    return None


def _parse_subtag_type(label: str) -> Optional[str]:
    t = _normalize_text(label).lower()
    if t.startswith("rec"):
        return "receita"
    if t.startswith("desp"):
        return "despesa"
    return None


def _parse_bool_sim(label: Any) -> bool:
    return _normalize_text(label).lower() in ("sim", "s", "yes", "true", "1")


def _match_label(mapping_type: str | None) -> str:
    return {"exact": "Exato", "pattern": "Padrão", "regex": "Regex"}.get(mapping_type or "", mapping_type or "—")


def _priority_label(priority: Any) -> str:
    try:
        n = int(priority)
    except (TypeError, ValueError):
        return "—"
    return {0: "Alta", 1: "Média", 2: "Baixa"}.get(n, str(n))


def _same_text(left: Any, right: Any, *, casefold: bool = False) -> bool:
    a = _normalize_text(str(left or ""))
    b = _normalize_text(str(right or ""))
    if casefold:
        return a.casefold() == b.casefold()
    return a == b


def _same_pct(left: Any, right: Any) -> bool:
    if left is None and right is None:
        return True
    if left is None or right is None:
        return False
    try:
        return Decimal(str(left)).quantize(Decimal("0.01")) == Decimal(str(right)).quantize(Decimal("0.01"))
    except Exception:
        return str(left) == str(right)


def _push_change(changes: list[dict[str, str]], field: str, label: str, before: Any, after: Any) -> None:
    b = _normalize_text(str(before)) if before not in (None, "") else ""
    a = _normalize_text(str(after)) if after not in (None, "") else ""
    if b == a:
        return
    changes.append({"field": field, "label": label, "before": b or "—", "after": a or "—"})


def _stored_criterion(existing: TransactionMapping, mapping_type: str) -> str:
    if mapping_type == "exact":
        raw = existing.original_description
    elif mapping_type == "pattern":
        raw = existing.pattern
    else:
        raw = existing.regex_pattern
    if existing.is_sensitive and raw:
        raw = decrypt_field(raw, True)
    return raw or ""


def _incoming_criterion(fields: dict[str, Any], mapping_type: str) -> str:
    if mapping_type == "exact":
        return str(fields.get("original_description") or "")
    if mapping_type == "pattern":
        return str(fields.get("pattern") or "")
    return str(fields.get("regex_pattern") or "")


def _resolve_subtag_for_mapping(
    db: Session,
    tenant_id: int,
    account_id: int,
    tag_name: str,
    subtag_name: str,
    subtag_type: str,
) -> tuple[Optional[int], Optional[str]]:
    tag_name = _normalize_text(tag_name)
    subtag_name = _normalize_text(subtag_name)
    if not subtag_name:
        return None, "Subtag é obrigatória"
    q = (
        db.query(Subtag)
        .join(Tag, Tag.id == Subtag.tag_id)
        .filter(
            Subtag.tenant_id == tenant_id,
            Tag.account_id == account_id,
            func.lower(Subtag.name) == subtag_name.lower(),
            Subtag.type == subtag_type,
        )
    )
    if tag_name:
        q = q.filter(func.lower(Tag.name) == tag_name.lower())
    row = q.first()
    if not row:
        hint = f"{tag_name}/{subtag_name}" if tag_name else subtag_name
        return None, f"Subtag não encontrada: {hint}"
    return int(row.id), None


def _criterion_is_masked(value: str) -> bool:
    return _normalize_text(value).lower() == SENSITIVE_MASK.lower()


def _mapping_subtag_type(db: Session, mapping: TransactionMapping) -> str | None:
    if not mapping.subtag_id:
        return None
    row = db.query(Subtag.type).filter(Subtag.id == mapping.subtag_id).first()
    return row[0] if row else None


def _rule_key(mapping_type: str, criterion: str, subtag_type: str | None) -> tuple[str, str, str]:
    text = _normalize_text(criterion)
    return (mapping_type, text if mapping_type == "regex" else text.casefold(), subtag_type or "")


def _id_match_is_same_rule(
    db: Session, existing: TransactionMapping, mapping_type: str, criterion: str, subtag_type: str,
) -> bool:
    """O ID da planilha pode ser de outro ambiente ou de antes de um reimport: só vale se a regra bater."""
    if existing.mapping_type != mapping_type:
        return False
    if _mapping_subtag_type(db, existing) not in (None, subtag_type):
        return False
    if _criterion_is_masked(criterion):
        return bool(existing.is_sensitive)
    return _same_text(_stored_criterion(existing, mapping_type), criterion, casefold=mapping_type != "regex")


def _file_class_label(tag_name: Any, subtag_name: Any) -> str | None:
    tag = _normalize_text(str(tag_name or ""))
    subtag = _normalize_text(str(subtag_name or ""))
    if not subtag:
        return None
    return (f"{tag}/{subtag}" if tag else subtag).casefold()


def _criterion_candidates(
    db: Session,
    account_id: int,
    mapping_type: str,
    criterion: str,
) -> list[TransactionMapping]:
    """Mapeamentos com o mesmo critério (pode haver vários: receita/despesa ou subtags diferentes)."""
    if not criterion or _criterion_is_masked(criterion):
        return []
    base = db.query(TransactionMapping).filter(
        TransactionMapping.account_id == account_id,
        TransactionMapping.mapping_type == mapping_type,
    )
    if mapping_type == "exact":
        base = base.filter(func.lower(TransactionMapping.original_description) == criterion.lower())
    elif mapping_type == "pattern":
        base = base.filter(func.lower(TransactionMapping.pattern) == criterion.lower())
    else:
        base = base.filter(TransactionMapping.regex_pattern == criterion)
    return base.order_by(TransactionMapping.id).all()


def _looks_like_unicode_escape(s: str) -> bool:
    if not s.startswith("\\u") or len(s) < 6:
        return False
    return all(c in "0123456789abcdefABCDEF" for c in s[2:6])


def _normalize_regex_criterion_from_excel(criterion: str) -> str:
    """
    Corrige escapes comuns após export/import Excel (ex.: \\b vira backspace ou \\uber).
    """
    s = criterion.strip()
    if not s:
        return s
    if "\x08" in s:
        s = s.replace("\x08", "\\b")
    if s.startswith("\\u") and not _looks_like_unicode_escape(s):
        s = "\\b" + s[1:]
    return s


def _python_regex_validation_error(pattern: str) -> str | None:
    """Mesma engine do MappingHelper (re.search, case-insensitive)."""
    if not pattern:
        return "Regex vazia"
    try:
        re.search(pattern, "sample text", re.IGNORECASE)
        return None
    except re.error as exc:
        return str(exc)


def _find_sensitive_mapping_without_criterion(
    db: Session,
    account_id: int,
    *,
    mapping_type: str,
    subtag_id: int,
    priority: int,
    expense_sharing_id: int | None,
) -> TransactionMapping | None:
    """Fallback para sensíveis exportados com critério mascarado e ID obsoleto."""
    q = db.query(TransactionMapping).filter(
        TransactionMapping.account_id == account_id,
        TransactionMapping.is_sensitive.is_(True),
        TransactionMapping.mapping_type == mapping_type,
        TransactionMapping.subtag_id == subtag_id,
        TransactionMapping.priority == priority,
    )
    if expense_sharing_id is not None:
        q = q.filter(TransactionMapping.expense_sharing_id == expense_sharing_id)
    else:
        q = q.filter(TransactionMapping.expense_sharing_id.is_(None))
    rows = q.limit(2).all()
    return rows[0] if len(rows) == 1 else None


def _mapping_apply_percentage(db: Session, mapping: TransactionMapping, is_receita: bool) -> Decimal:
    from app.utils.sharing_percentage import resolve_ownership_percentage

    sharing = None
    if mapping.expense_sharing_id:
        sharing = (
            db.query(ExpenseSharingSetting)
            .filter(ExpenseSharingSetting.id == mapping.expense_sharing_id)
            .first()
        )
    return resolve_ownership_percentage(
        kind="revenue" if is_receita else "expense",
        mapping=mapping,
        sharing=sharing,
    )


class _RemapOpts:
    def __init__(self, *, overwrite_sharing: bool, confirm: bool):
        self.overwrite_sharing = overwrite_sharing
        self.confirm_closed_closure_impact = confirm
        self.skip_sharing_if_null = not overwrite_sharing
        self.model_fields_set = {"overwrite_sharing"}


def _mapping_row_snapshot(raw: dict[str, Any]) -> dict[str, Any]:
    """Campos editáveis reenviados ao preview/import após correção manual."""
    return {
        "row_index": raw.get("row_index"),
        "mapping_id": raw.get("mapping_id"),
        "match": raw.get("match") or raw.get("match_label") or "",
        "criterion": raw.get("criterion") or "",
        "priority": raw.get("priority"),
        "mapped_description": raw.get("mapped_description") or "",
        "subtag_type": raw.get("subtag_type") or raw.get("tipo") or "",
        "tag_name": raw.get("tag_name") or raw.get("tag") or "",
        "subtag_name": raw.get("subtag_name") or raw.get("subtag") or "",
        "partner_name": raw.get("partner_name") or "",
        "contribution_pct": raw.get("contribution_pct"),
        "is_sensitive": raw.get("is_sensitive"),
    }


def _merge_mapping_correction(
    corrections: list[dict[str, Any]],
    raw: dict[str, Any],
    line: int,
    reason: str,
    problems: list[str],
) -> None:
    """Acumula pendências por linha (tag/subtag e/ou compartilhamento não encontrados)."""
    for entry in corrections:
        if entry["row"] != line:
            continue
        for p in problems:
            if p not in entry["problems"]:
                entry["problems"].append(p)
        if reason:
            existing_reason = str(entry.get("reason") or "")
            if reason not in existing_reason:
                entry["reason"] = (
                    f"{existing_reason}; {reason}" if existing_reason else reason
                )
        entry["row_data"] = _mapping_row_snapshot(raw)
        return
    corrections.append({
        "row": line,
        "reason": reason,
        "problems": list(problems),
        "row_data": _mapping_row_snapshot(raw),
    })


def _row_payload(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "row_index": raw.get("row_index"),
        "mapping_id": raw.get("mapping_id"),
        "match_label": raw.get("match") or raw.get("match_label"),
        "criterion": raw.get("criterion") or "",
        "priority_label": raw.get("priority"),
        "mapped_description": raw.get("mapped_description") or "",
        "subtag_type_label": raw.get("subtag_type") or raw.get("tipo"),
        "tag_name": raw.get("tag_name") or raw.get("tag") or "",
        "subtag_name": raw.get("subtag_name") or raw.get("subtag") or "",
        "partner_name": raw.get("partner_name") or "",
        "contribution_pct": raw.get("contribution_pct"),
        "is_sensitive_label": raw.get("is_sensitive"),
    }


ACTION_NOT_CREATED = "Não será criado"
ACTION_NOT_UPDATED = "Não será alterado"
ACTION_NOT_IMPORTED = "Linha ignorada"
ACTION_KEEP_SUBTAG = "Subtag atual mantida"
ACTION_NO_SHARING = "Sem compartilhamento"


def _plan_mapping_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    rows: list[dict[str, Any]],
    batch: ImportBatch | None = None,
) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    planned: list[dict[str, Any]] = []
    corrections: list[dict[str, Any]] = []
    skipped = 0

    file_rule_keys: set[tuple[str, str, str]] = set()
    file_rule_labels: dict[tuple[str, str, str], set[str]] = {}
    claimed_ids: set[int] = set()
    label_cache: dict[int, str | None] = {}
    for raw in rows:
        p = _row_payload(raw)
        mt = _parse_match_type(str(p["match_label"] or ""))
        crit = _normalize_text(str(p["criterion"]))
        if not mt or not crit or _criterion_is_masked(crit):
            continue
        if mt == "regex":
            crit = _normalize_regex_criterion_from_excel(crit)
        st = _parse_subtag_type(str(p["subtag_type_label"] or "")) or "despesa"
        key = _rule_key(mt, crit, st)
        file_rule_keys.add(key)
        label = _file_class_label(p["tag_name"], p["subtag_name"])
        if label:
            file_rule_labels.setdefault(key, set()).add(label)

    for raw in rows:
        p = _row_payload(raw)
        line = int(p["row_index"] or 0)
        mapping_type = _parse_match_type(str(p["match_label"] or ""))
        if not mapping_type:
            issues.append({
                "row": line,
                "reason": "Tipo de match inválido (use Exato, Padrão ou Regex)",
                "action": ACTION_NOT_IMPORTED,
            })
            skipped += 1
            continue

        subtag_name_norm = _normalize_text(str(p["subtag_name"]))
        subtag_type = _parse_subtag_type(str(p["subtag_type_label"] or ""))
        if subtag_name_norm and not subtag_type:
            issues.append({
                "row": line,
                "reason": "Tipo inválido (Receita ou Despesa)",
                "action": ACTION_NOT_IMPORTED,
            })
            skipped += 1
            continue
        if not subtag_type:
            subtag_type = "despesa"

        priority = _parse_priority(p["priority_label"])
        if priority is None:
            priority = {"exact": 0, "pattern": 1, "regex": 2}[mapping_type]

        is_sensitive = _parse_bool_sim(p["is_sensitive_label"])
        criterion = _normalize_text(str(p["criterion"]))
        if mapping_type == "regex" and criterion and not _criterion_is_masked(criterion):
            criterion = _normalize_regex_criterion_from_excel(criterion)
        mapped_desc = _normalize_text(str(p["mapped_description"]))

        if is_sensitive and _criterion_is_masked(criterion):
            criterion_for_create = None
        else:
            criterion_for_create = criterion

        if is_sensitive and mapped_desc and _criterion_is_masked(mapped_desc):
            mapped_desc_for_create = None
        else:
            mapped_desc_for_create = mapped_desc or None

        mapping_id_raw = p["mapping_id"]
        mapping_id: Optional[int] = None
        if mapping_id_raw not in (None, "", 0):
            try:
                mapping_id = int(mapping_id_raw)
            except (TypeError, ValueError):
                issues.append({
                    "row": line,
                    "reason": f"ID inválido: {mapping_id_raw}",
                    "action": ACTION_NOT_IMPORTED,
                })
                skipped += 1
                continue

        file_label = _file_class_label(p["tag_name"], subtag_name_norm)
        rule_key = _rule_key(mapping_type, criterion, subtag_type)
        claimed_labels = file_rule_labels.get(rule_key, set())

        def _candidate_label(mapping: TransactionMapping) -> str | None:
            if mapping.id not in label_cache:
                label = _subtag_label(db, tenant_id, mapping.subtag_id)
                label_cache[mapping.id] = label.casefold() if label else None
            return label_cache[mapping.id]

        def _free_for_row(mapping: TransactionMapping) -> bool:
            if mapping.id in claimed_ids:
                return False
            label = _candidate_label(mapping)
            return not (label and label != file_label and label in claimed_labels)

        existing: TransactionMapping | None = None
        by_id: TransactionMapping | None = None
        if mapping_id:
            by_id = (
                db.query(TransactionMapping)
                .filter(
                    TransactionMapping.id == mapping_id,
                    TransactionMapping.tenant_id == tenant_id,
                    TransactionMapping.account_id == account_id,
                )
                .first()
            )
            if not (by_id and _id_match_is_same_rule(db, by_id, mapping_type, criterion, subtag_type)):
                by_id = None
        if not _criterion_is_masked(criterion):
            candidates = _criterion_candidates(db, account_id, mapping_type, criterion)
            same_type = [c for c in candidates if _mapping_subtag_type(db, c) == subtag_type]
            other_type = [
                c for c in candidates
                if _mapping_subtag_type(db, c) != subtag_type
                and _rule_key(mapping_type, criterion, _mapping_subtag_type(db, c)) not in file_rule_keys
            ]
            ordered = (
                [c for c in same_type if file_label and _candidate_label(c) == file_label]
                + ([by_id] if by_id else [])
                + same_type
                + other_type
            )
            existing = next((c for c in ordered if _free_for_row(c)), None)
        elif by_id and _free_for_row(by_id):
            existing = by_id

        subtag_id: Optional[int] = None
        pending_subtag = False
        if subtag_name_norm:
            subtag_id, sub_err = _resolve_subtag_for_mapping(
                db, tenant_id, account_id,
                str(p["tag_name"]), subtag_name_norm, subtag_type,
            )
            if sub_err and batch and batch.has_subtag(str(p["tag_name"]), subtag_name_norm, subtag_type):
                sub_err = None
                pending_subtag = True
            if sub_err:
                _merge_mapping_correction(corrections, raw, line, sub_err, ["subtag"])
                if existing:
                    issues.append({
                        "row": line,
                        "reason": (
                            f"{sub_err} Use a aba Preencher manual ou a subtag atual será mantida."
                        ),
                        "action": ACTION_KEEP_SUBTAG,
                    })
                else:
                    reason = (
                        f"{sub_err} Mapeamento novo não importado "
                        "(subtag é obrigatória)."
                    )
                    issues.append({"row": line, "reason": reason, "action": ACTION_NOT_CREATED})
                    skipped += 1
                    continue

        if existing:
            effective_subtag_id = subtag_id if subtag_id is not None else existing.subtag_id
        elif subtag_id is not None or pending_subtag:
            effective_subtag_id = subtag_id
        else:
            reason = "Subtag é obrigatória para mapeamento novo."
            issues.append({"row": line, "reason": reason, "action": ACTION_NOT_CREATED})
            problems = ["subtag"]
            if _normalize_text(str(p["partner_name"])):
                problems.append("sharing")
            _merge_mapping_correction(corrections, raw, line, reason, problems)
            skipped += 1
            continue

        partner_name_norm = _normalize_text(str(p["partner_name"]))
        sharing_id, ownership, share_err = _resolve_sharing(
            db, tenant_id, account_id,
            str(p["partner_name"]),
            p["contribution_pct"],
        )
        pending_sharing = False
        if share_err and partner_name_norm and batch and batch.has_sharing(partner_name_norm):
            share_err = None
            sharing_id = None
            ownership = None
            pending_sharing = True
        if share_err and partner_name_norm:
            _merge_mapping_correction(corrections, raw, line, share_err, ["sharing"])
            issues.append({
                "row": line,
                "reason": (
                    f"{share_err} Use a aba Preencher manual ou importe sem compartilhamento."
                ),
                "action": ACTION_NO_SHARING,
            })
            sharing_id = None
            ownership = None
        elif share_err:
            issues.append({
                "row": line,
                "reason": f"{share_err} Mapeamento importado sem compartilhamento.",
                "action": ACTION_NO_SHARING,
            })
            sharing_id = None
            ownership = None

        my_pct = None
        rev_pct = None
        if ownership is not None:
            if subtag_type == "receita":
                rev_pct = float(ownership)
            else:
                my_pct = float(ownership)

        if not existing and is_sensitive and _criterion_is_masked(criterion):
            sensitive_match = _find_sensitive_mapping_without_criterion(
                db,
                account_id,
                mapping_type=mapping_type,
                subtag_id=effective_subtag_id,
                priority=priority,
                expense_sharing_id=sharing_id,
            )
            if sensitive_match and sensitive_match.id not in claimed_ids:
                existing = sensitive_match

        if is_sensitive and not existing:
            if not criterion_for_create or not mapped_desc_for_create:
                issues.append({
                    "row": line,
                    "reason": "Mapeamento sensível novo exige critério e descrição mapeada (não exportáveis)",
                    "action": ACTION_NOT_CREATED,
                })
                skipped += 1
                continue

        if not is_sensitive and not _criterion_is_masked(criterion):
            skip_action = ACTION_NOT_UPDATED if existing else ACTION_NOT_CREATED
            if mapping_type == "exact" and not criterion:
                issues.append({"row": line, "reason": "Critério obrigatório para match Exato", "action": skip_action})
                skipped += 1
                continue
            if mapping_type == "pattern" and not criterion:
                issues.append({"row": line, "reason": "Critério obrigatório para match Padrão", "action": skip_action})
                skipped += 1
                continue
            if mapping_type == "regex" and not criterion:
                issues.append({"row": line, "reason": "Critério obrigatório para match Regex", "action": skip_action})
                skipped += 1
                continue
            if mapping_type == "regex":
                py_err = _python_regex_validation_error(criterion)
                if py_err:
                    issues.append({"row": line, "reason": f"Regex inválida: {py_err}", "action": skip_action})
                    skipped += 1
                    continue

        fields: dict[str, Any] = {
            "mapping_type": mapping_type,
            "subtag_id": effective_subtag_id,
            "priority": priority,
            "expense_sharing_id": sharing_id,
            "my_contribution_percentage": my_pct,
            "revenue_contribution_percentage": rev_pct,
            "is_sensitive": is_sensitive,
        }

        touch_criterion = not (existing and existing.is_sensitive and _criterion_is_masked(criterion))
        if touch_criterion and not _criterion_is_masked(criterion):
            if mapping_type == "exact":
                fields["original_description"] = criterion.lower()
            elif mapping_type == "pattern":
                fields["pattern"] = criterion.lower() if not is_sensitive else criterion
            else:
                fields["regex_pattern"] = criterion

        touch_mapped = not (
            existing and existing.is_sensitive and mapped_desc and _criterion_is_masked(mapped_desc)
        )
        if touch_mapped and mapped_desc_for_create is not None:
            fields["mapped_description"] = mapped_desc_for_create

        tag_part = _normalize_text(str(p["tag_name"]))
        file_class = f"{tag_part}/{subtag_name_norm}" if subtag_name_norm and tag_part else subtag_name_norm
        row_label = mapped_desc or criterion or "Mapeamento"

        if existing:
            claimed_ids.add(existing.id)
            changes: list[dict[str, str]] = []
            before_class = _subtag_label(db, tenant_id, existing.subtag_id) or ""
            after_class = _subtag_label(db, tenant_id, subtag_id) if subtag_id else file_class
            class_changed = False
            if subtag_id is not None and existing.subtag_id != subtag_id:
                class_changed = True
            elif pending_subtag and not _same_text(before_class, file_class, casefold=True):
                class_changed = True
            if class_changed:
                _push_change(changes, "subtag", "Tag/Subtag", before_class, after_class or file_class)

            default_priority = {"exact": 0, "pattern": 1, "regex": 2}[mapping_type]
            existing_priority = existing.priority if existing.priority is not None else default_priority
            if int(existing_priority) != int(priority):
                _push_change(
                    changes, "prioridade", "Prioridade", _priority_label(existing_priority), _priority_label(priority),
                )

            before_share = _sharing_label(db, tenant_id, existing.expense_sharing_id, account_id) or ""
            if sharing_id is not None and existing.expense_sharing_id != sharing_id:
                _push_change(
                    changes,
                    "compartilhamento",
                    "Compartilhamento",
                    before_share,
                    _sharing_label(db, tenant_id, sharing_id, account_id) or partner_name_norm,
                )
            elif pending_sharing and not _same_text(before_share, partner_name_norm, casefold=True):
                _push_change(changes, "compartilhamento", "Compartilhamento", before_share, partner_name_norm)
            elif not partner_name_norm and existing.expense_sharing_id:
                _push_change(changes, "compartilhamento", "Compartilhamento", before_share, "")

            if bool(existing.is_sensitive) != bool(is_sensitive):
                _push_change(
                    changes,
                    "sensível",
                    "Sensível",
                    "Sim" if existing.is_sensitive else "Não",
                    "Sim" if is_sensitive else "Não",
                )

            if touch_criterion and not _criterion_is_masked(criterion):
                stored = _stored_criterion(existing, mapping_type)
                incoming = _incoming_criterion(fields, mapping_type)
                if not _same_text(stored, incoming, casefold=mapping_type != "regex"):
                    _push_change(changes, "critério", "Critério", stored, incoming)

            if existing.mapping_type != mapping_type:
                _push_change(
                    changes, "tipo match", "Match", _match_label(existing.mapping_type), _match_label(mapping_type),
                )

            if touch_mapped and mapped_desc_for_create is not None:
                stored_mapped = existing.mapped_description or ""
                if existing.is_sensitive and stored_mapped:
                    stored_mapped = decrypt_field(stored_mapped, True) or ""
                if not _same_text(stored_mapped, mapped_desc_for_create, casefold=True):
                    _push_change(changes, "descrição", "Descrição mapeada", stored_mapped, mapped_desc_for_create)

            if partner_name_norm:
                file_pct = rev_pct if subtag_type == "receita" else my_pct
                stored_pct = (
                    existing.revenue_contribution_percentage
                    if subtag_type == "receita"
                    else existing.my_contribution_percentage
                )
                if file_pct is not None and not _same_pct(stored_pct, file_pct):
                    _push_change(changes, "contribuição", "Contribuição (%)", stored_pct, file_pct)

            if not changes:
                planned.append({
                    "action": "unchanged",
                    "line": line,
                    "mapping_id": existing.id,
                    "fields": fields,
                    "label": row_label,
                    "classification": file_class,
                })
                continue

            planned.append({
                "action": "update",
                "line": line,
                "mapping_id": existing.id,
                "existing": existing,
                "fields": fields,
                "changes": changes,
                "label": row_label,
                "classification": file_class,
            })
        else:
            if not touch_criterion or _criterion_is_masked(criterion):
                issues.append({
                    "row": line,
                    "reason": "Critério obrigatório para novo mapeamento",
                    "action": ACTION_NOT_CREATED,
                })
                skipped += 1
                continue
            planned.append({
                "action": "create",
                "line": line,
                "fields": fields,
                "label": row_label,
                "classification": file_class,
            })

    return {"planned": planned, "issues": issues, "skipped": skipped, "corrections": corrections}


def preview_visual_mapping_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    rows: list[dict[str, Any]],
    batch: ImportBatch | None = None,
) -> dict[str, Any]:
    plan = _plan_mapping_import(db, tenant_id, account_id, rows, batch)
    creates: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    unchanged = 0

    for item in plan["planned"]:
        base = {
            "row": item["line"],
            "mapping_id": item.get("mapping_id"),
            "action": item["action"],
        }
        if item["action"] == "create":
            creates.append({
                **base,
                "label": item.get("label") or "Mapeamento",
                "fields": _mapping_display(
                    db, tenant_id, account_id, item["fields"], item.get("classification") or "",
                ),
            })
        elif item["action"] == "update":
            updates.append({
                **base,
                "label": item.get("label") or "Mapeamento",
                "changes": item.get("changes") or [],
            })
        else:
            unchanged += 1

    corrections = plan.get("corrections") or []
    return {
        "summary": {
            "creates": len(creates),
            "updates": len(updates),
            "unchanged": unchanged,
            "skipped_invalid": plan["skipped"],
            "issues": len(plan["issues"]),
            "corrections": len(corrections),
        },
        "creates": creates,
        "updates": updates,
        "issues": plan["issues"],
        "corrections": corrections,
    }


def _mapping_display(
    db: Session,
    tenant_id: int,
    account_id: int,
    fields: dict[str, Any],
    classification: str,
) -> dict[str, str]:
    mapping_type = str(fields.get("mapping_type") or "")
    subtag = _subtag_label(db, tenant_id, fields.get("subtag_id")) or classification or "—"
    sharing = _sharing_label(db, tenant_id, fields.get("expense_sharing_id"), account_id) or "—"
    pct = fields.get("revenue_contribution_percentage")
    if pct is None:
        pct = fields.get("my_contribution_percentage")
    criterion = _incoming_criterion(fields, mapping_type) or "—"
    return {
        "match": _match_label(mapping_type),
        "criterion": criterion,
        "mapped_description": str(fields.get("mapped_description") or "—"),
        "classification": subtag,
        "priority": _priority_label(fields.get("priority")),
        "sharing": sharing,
        "contribution": "—" if pct is None else str(pct),
        "sensitive": "Sim" if fields.get("is_sensitive") else "Não",
    }


def _preview_fields(fields: dict[str, Any]) -> dict[str, Any]:
    out = dict(fields)
    for key in ("original_description", "pattern", "regex_pattern", "mapped_description"):
        if key in out and out[key]:
            val = str(out[key])
            if len(val) > 80:
                out[key] = val[:77] + "..."
    return out


def _apply_fields_to_mapping(
    mapping: TransactionMapping,
    fields: dict[str, Any],
    *,
    encrypt_sensitive: bool,
) -> None:
    from app.utils.sensitive_mapping import (
        encrypt_field,
        original_for_storage,
        pattern_for_storage,
        regex_for_storage,
    )

    is_sensitive = bool(fields.get("is_sensitive"))
    mapping.is_sensitive = is_sensitive
    mapping.subtag_id = int(fields["subtag_id"])
    mapping.priority = int(fields["priority"])
    mapping.expense_sharing_id = fields.get("expense_sharing_id")
    mapping.my_contribution_percentage = fields.get("my_contribution_percentage")
    mapping.revenue_contribution_percentage = fields.get("revenue_contribution_percentage")
    new_type = fields["mapping_type"]
    if mapping.mapping_type != new_type:
        mapping.original_description = None
        mapping.pattern = None
        mapping.regex_pattern = None
    mapping.mapping_type = new_type

    if "original_description" in fields:
        val = fields["original_description"]
        mapping.original_description = original_for_storage(val, is_sensitive) if val else None
    if "pattern" in fields:
        val = fields["pattern"]
        mapping.pattern = pattern_for_storage(val, is_sensitive) if val else None
    if "regex_pattern" in fields:
        val = fields["regex_pattern"]
        mapping.regex_pattern = regex_for_storage(val, is_sensitive) if val else None
    if "mapped_description" in fields:
        val = fields["mapped_description"]
        if val and encrypt_sensitive and is_sensitive:
            mapping.mapped_description = encrypt_field(val)
        else:
            mapping.mapped_description = val


def _ensure_batch_remap_allowed(
    db: Session,
    tenant_id: int,
    account_id: int,
    mappings: list[TransactionMapping],
    *,
    overwrite_sharing: bool,
    confirm: bool,
) -> None:
    if confirm or not mappings:
        return
    merged = closure_impact_none()
    blocked = False
    for mapping in mappings:
        try:
            ensure_mapping_remap_allowed(
                db,
                tenant_id,
                account_id,
                mapping,
                overwrite_sharing=overwrite_sharing,
                confirm_closed_closure_impact=False,
                records_updated_estimate=0,
            )
        except AccountPeriodClosedError as exc:
            blocked = True
            if exc.payload:
                merged = merge_closure_impacts(merged, exc.payload) or merged
    if blocked:
        from app.services.closed_period_edit_service import closure_impact_confirmation_prompt

        if merged.get("impact_type") == "none" or not merged.get("year_months"):
            merged = closure_impact_confirmation_prompt(
                "split_recalc" if overwrite_sharing else "classification",
                message="Importação com remapeamento afetará meses fechados. Confirme para continuar.",
            )
        raise AccountPeriodClosedError(
            merged.get("message", "Confirme o impacto nos fechamentos."),
            merged,
        )


def apply_visual_mapping_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    *,
    rows: list[dict[str, Any]],
    auto_run_remap: bool,
    overwrite_sharing: bool,
    confirm_closed_closure_impact: bool,
) -> dict[str, Any]:
    plan = _plan_mapping_import(db, tenant_id, account_id, rows)
    issues: list[dict[str, Any]] = list(plan["issues"])
    stats = {"created": 0, "updated": 0, "unchanged": 0, "remap_records": 0, "skipped": plan["skipped"]}

    touched_for_remap: list[TransactionMapping] = []

    for item in plan["planned"]:
        if item["action"] == "unchanged":
            stats["unchanged"] += 1
            continue

        fields = item["fields"]
        if item["action"] == "create":
            mapping = TransactionMapping(
                account_id=account_id,
                tenant_id=tenant_id,
                created_by=user_id,
            )
            _apply_fields_to_mapping(mapping, fields, encrypt_sensitive=True)
            db.add(mapping)
            db.flush()
            stats["created"] += 1
            touched_for_remap.append(mapping)
        elif item["action"] == "update":
            mapping = item["existing"]
            _apply_fields_to_mapping(mapping, fields, encrypt_sensitive=True)
            db.flush()
            stats["updated"] += 1
            touched_for_remap.append(mapping)

    closure_impact: dict[str, Any] | None = None
    if auto_run_remap and touched_for_remap:
        from app.services.mapping_remap_service import (
            NO_TRANSACTION_DATA_DETAIL,
            account_has_remap_transaction_data,
        )

        if account_has_remap_transaction_data(db, tenant_id, account_id):
            ordered = sort_mappings_for_remap(touched_for_remap)
            _ensure_batch_remap_allowed(
                db,
                tenant_id,
                account_id,
                ordered,
                overwrite_sharing=overwrite_sharing,
                confirm=confirm_closed_closure_impact,
            )

            opts = _RemapOpts(overwrite_sharing=overwrite_sharing, confirm=confirm_closed_closure_impact)
            merged: dict[str, Any] = closure_impact_none()
            for mapping in ordered:
                bank_n, cc_n, ben_n = apply_mapping_remap(
                    db,
                    tenant_id,
                    account_id,
                    mapping,
                    opts,
                    _mapping_apply_percentage,
                )
                total = bank_n + cc_n + ben_n
                stats["remap_records"] += total
                impact = finalize_mapping_remap_closures(
                    db,
                    tenant_id,
                    account_id,
                    mapping,
                    overwrite_sharing=overwrite_sharing,
                    records_updated=total,
                )
                merged = merge_closure_impacts(merged, impact) or merged
            if merged.get("impact_type") != "none":
                closure_impact = merged
        else:
            stats["remap_skipped_no_transactions"] = 1
            issues.append({"row": 0, "reason": NO_TRANSACTION_DATA_DETAIL})

    return {
        "success": True,
        "stats": stats,
        "issues": issues,
        "closure_impact": closure_impact,
    }
