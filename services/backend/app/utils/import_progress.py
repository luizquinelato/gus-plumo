"""Progresso de importação por linha, consultado em paralelo ao POST.

Cada arquivo da leva vale a mesma fatia. Dentro do arquivo, a fatia é dividida
pelo número de linhas. O POST roda em thread (endpoint síncrono) e atualiza
este estado; o frontend consulta GET /api/import/progress/{job_id}.
"""

from __future__ import annotations

import threading
import time
import uuid
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException

_lock = threading.Lock()
_jobs: dict[str, dict] = {}
_active_job: ContextVar[Optional[str]] = ContextVar("import_progress_job", default=None)
_JOB_TTL_SECONDS = 30 * 60


@dataclass
class ImportProgressScope:
    token: Optional[Token]
    job_id: Optional[str]


def normalize_job_id(job_id: Optional[str]) -> Optional[str]:
    if not job_id or not str(job_id).strip():
        return None
    try:
        return str(uuid.UUID(str(job_id).strip()))
    except ValueError:
        return None


def _drop_expired_jobs(now: float) -> None:
    expired = [
        key
        for key, job in _jobs.items()
        if now - float(job.get("created_at") or 0) > _JOB_TTL_SECONDS
    ]
    for key in expired:
        _jobs.pop(key, None)


def activate_import_job(job_id: Optional[str], current_user: dict) -> ImportProgressScope:
    """Registra o job e liga o contexto da thread que processa as linhas."""
    normalized = normalize_job_id(job_id)
    if not normalized:
        return ImportProgressScope(token=None, job_id=None)

    user_id = current_user.get("user_id") or current_user.get("id")
    tenant_id = current_user.get("tenant_id")
    now = time.time()
    with _lock:
        _drop_expired_jobs(now)
        _jobs[normalized] = {
            "processed": 0,
            "total": 0,
            "fraction": 0.0,
            "phases": 1,
            "user_id": user_id,
            "tenant_id": tenant_id,
            "created_at": now,
        }
    token = _active_job.set(normalized)
    return ImportProgressScope(token=token, job_id=normalized)


def deactivate_import_job(scope: ImportProgressScope) -> None:
    if scope.token is not None:
        _active_job.reset(scope.token)
    if scope.job_id:
        with _lock:
            _jobs.pop(scope.job_id, None)


def set_import_phase_count(count: int) -> None:
    """Divide o arquivo em etapas (leitura, transformação, gravação). Sem job, não faz nada."""
    job_id = _active_job.get()
    if not job_id:
        return
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job["phases"] = max(1, int(count))


def report_row_progress(
    processed: int,
    total: int,
    phase: int = 0,
    *,
    step: int = 0,
    steps: int = 1,
) -> None:
    """Atualiza a etapa corrente. A barra só chega a 100% na última etapa.

    ``phase`` é a etapa do arquivo (0..phases-1). ``step`` divide uma etapa
    quando o mesmo arquivo é percorrido mais de uma vez (limpeza, filtro, leitura).
    """
    job_id = _active_job.get()
    if not job_id or total <= 0:
        return
    total = int(total)
    processed = max(0, min(int(processed), total))
    steps = max(1, int(steps))
    step = min(max(0, int(step)), steps - 1)
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        phases = max(1, int(job.get("phases") or 1))
        phase_index = min(max(0, int(phase)), phases - 1)
        row_fraction = processed / total
        within_phase = (step + row_fraction) / steps
        fraction = (phase_index + within_phase) / phases
        current_fraction = float(job.get("fraction") or 0)
        if fraction + 1e-9 < current_fraction:
            return
        job["fraction"] = fraction
        job["processed"] = processed
        job["total"] = total


def read_import_progress(job_id: str, current_user: dict) -> dict:
    normalized = normalize_job_id(job_id)
    if not normalized:
        raise HTTPException(status_code=404, detail="Progresso não encontrado")

    user_id = current_user.get("user_id") or current_user.get("id")
    tenant_id = current_user.get("tenant_id")
    with _lock:
        job = _jobs.get(normalized)
        if job is None:
            raise HTTPException(status_code=404, detail="Progresso não encontrado")
        if str(job.get("user_id")) != str(user_id) or str(job.get("tenant_id")) != str(tenant_id):
            raise HTTPException(status_code=404, detail="Progresso não encontrado")
        return {
            "processed": int(job.get("processed") or 0),
            "total": int(job.get("total") or 0),
            "fraction": float(job.get("fraction") or 0),
        }
