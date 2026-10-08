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
)

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


def _find_existing_mapping_by_criterion(
    db: Session,
    account_id: int,
    mapping_type: str,
    criterion: str,
) -> TransactionMapping | None:
    """Localiza mapeamento existente quando o ID da planilha é de outro ambiente."""
    if not criterion or _criterion_is_masked(criterion):
        return None
    base = db.query(TransactionMapping).filter(
        TransactionMapping.account_id == account_id,
        TransactionMapping.mapping_type == mapping_type,
    )
    if mapping_type == "exact":
        return base.filter(
            func.lower(TransactionMapping.original_description) == criterion.lower(),
        ).first()
    if mapping_type == "pattern":
        return base.filter(
            func.lower(TransactionMapping.pattern) == criterion.lower(),
        ).first()
    return base.filter(TransactionMapping.regex_pattern == criterion).first()


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

    for raw in rows:
        p = _row_payload(raw)
        line = int(p["row_index"] or 0)
        mapping_type = _parse_match_type(str(p["match_label"] or ""))
        if not mapping_type:
            issues.append({"row": line, "reason": "Tipo de match inválido (use Exato, Padrão ou Regex)"})
            skipped += 1
            continue

        subtag_name_norm = _normalize_text(str(p["subtag_name"]))
        subtag_type = _parse_subtag_type(str(p["subtag_type_label"] or ""))
        if subtag_name_norm and not subtag_type:
            issues.append({"row": line, "reason": "Tipo inválido (Receita ou Despesa)"})
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
                issues.append({"row": line, "reason": f"ID inválido: {mapping_id_raw}"})
                skipped += 1
                continue

        existing: TransactionMapping | None = None
        if mapping_id:
            existing = (
                db.query(TransactionMapping)
                .filter(
                    TransactionMapping.id == mapping_id,
                    TransactionMapping.account_id == account_id,
                )
                .first()
            )
        if not existing and not _criterion_is_masked(criterion):
            existing = _find_existing_mapping_by_criterion(
                db, account_id, mapping_type, criterion,
            )

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
                    })
                else:
                    reason = (
                        f"{sub_err} Mapeamento novo não importado "
                        "(subtag é obrigatória)."
                    )
                    issues.append({"row": line, "reason": reason})
                    skipped += 1
                    continue

        if existing:
            effective_subtag_id = subtag_id if subtag_id is not None else existing.subtag_id
        elif subtag_id is not None or pending_subtag:
            effective_subtag_id = subtag_id
        else:
            reason = "Subtag é obrigatória para mapeamento novo."
            issues.append({"row": line, "reason": reason})
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
        if share_err and partner_name_norm and batch and batch.has_sharing(partner_name_norm):
            share_err = None
            sharing_id = None
            ownership = None
        if share_err and partner_name_norm:
            _merge_mapping_correction(corrections, raw, line, share_err, ["sharing"])
            issues.append({
                "row": line,
                "reason": (
                    f"{share_err} Use a aba Preencher manual ou importe sem compartilhamento."
                ),
            })
            sharing_id = None
            ownership = None
        elif share_err:
            issues.append({
                "row": line,
                "reason": f"{share_err} Mapeamento importado sem compartilhamento.",
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
            existing = _find_sensitive_mapping_without_criterion(
                db,
                account_id,
                mapping_type=mapping_type,
                subtag_id=effective_subtag_id,
                priority=priority,
                expense_sharing_id=sharing_id,
            )

        if is_sensitive and not existing:
            if not criterion_for_create or not mapped_desc_for_create:
                issues.append({
                    "row": line,
                    "reason": "Mapeamento sensível novo exige critério e descrição mapeada (não exportáveis)",
                })
                skipped += 1
                continue

        if not is_sensitive and not _criterion_is_masked(criterion):
            if mapping_type == "exact" and not criterion:
                issues.append({"row": line, "reason": "Critério obrigatório para match Exato"})
                skipped += 1
                continue
            if mapping_type == "pattern" and not criterion:
                issues.append({"row": line, "reason": "Critério obrigatório para match Padrão"})
                skipped += 1
                continue
            if mapping_type == "regex" and not criterion:
                issues.append({"row": line, "reason": "Critério obrigatório para match Regex"})
                skipped += 1
                continue
            if mapping_type == "regex":
                py_err = _python_regex_validation_error(criterion)
                if py_err:
                    issues.append({"row": line, "reason": f"Regex inválida: {py_err}"})
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

        if existing:
            changes: list[str] = []
            if subtag_id is not None and existing.subtag_id != subtag_id:
                changes.append("subtag")
            if existing.priority != priority:
                changes.append("prioridade")
            if (existing.expense_sharing_id or None) != (sharing_id or None):
                changes.append("compartilhamento")
            if existing.is_sensitive != is_sensitive:
                changes.append("sensível")
            if touch_criterion:
                if mapping_type == "exact" and fields.get("original_description") != existing.original_description:
                    changes.append("critério")
                if mapping_type == "pattern" and fields.get("pattern") != existing.pattern:
                    changes.append("critério")
                if mapping_type == "regex" and fields.get("regex_pattern") != existing.regex_pattern:
                    changes.append("critério")
            if existing.mapping_type != mapping_type:
                changes.append("tipo match")

            if not changes:
                planned.append({
                    "action": "unchanged",
                    "line": line,
                    "mapping_id": existing.id,
                    "fields": fields,
                })
                continue

            planned.append({
                "action": "update",
                "line": line,
                "mapping_id": existing.id,
                "existing": existing,
                "fields": fields,
                "changes": changes,
            })
        else:
            if not touch_criterion or _criterion_is_masked(criterion):
                issues.append({"row": line, "reason": "Critério obrigatório para novo mapeamento"})
                skipped += 1
                continue
            planned.append({
                "action": "create",
                "line": line,
                "fields": fields,
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
            creates.append({**base, "fields": _preview_fields(item["fields"])})
        elif item["action"] == "update":
            updates.append({**base, "changes": item.get("changes") or [], "fields": _preview_fields(item["fields"])})
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
