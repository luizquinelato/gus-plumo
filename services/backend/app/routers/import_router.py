# -*- coding: utf-8 -*-
"""
Import Router - Endpoints para importação de extratos e faturas
"""
import os
import re
import tempfile
import shutil
import logging
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException, Form, Depends, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
import pandas as pd
import psycopg2
from psycopg2.extras import RealDictCursor

from ..converters import CartaoConverter, inspect_invoice_pdf
from ..utils.account_import_password import (
    account_default_import_file_password,
    load_account_for_user,
)
from ..utils.pdf_password import (
    PdfPasswordInvalid,
    PdfPasswordRequired,
    pdf_still_needs_user_password,
    resolve_pdf_password_at_index,
)
from ..utils.invoice_import_diagnostics import explain_empty_cartao_import_batch
from ..utils import MappingHelper
from ..services.fatura_service import FaturaService
from ..etl import ExtratoETL
from ..database import get_db, DATABASE_URL
from ..routers.excel_import_router import save_extrato_records
from ..dependencies.auth import require_account
from ..models.unified_models import Account, Cartao

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/import", tags=["import"])

CONVERSION_TXT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "logs", "pdf_conversion")


def _account_default_pdf_password(db: Session, current_user: dict) -> Optional[str]:
    tenant_id = current_user.get("tenant_id")
    account_id = current_user.get("account_id")
    account = load_account_for_user(db, tenant_id, account_id)
    return account_default_import_file_password(account)


class DetectInvoiceFileResult(BaseModel):
    filename: str
    status: str
    issuer: Optional[str] = None
    issuer_label: Optional[str] = None
    year: Optional[str] = None
    month: Optional[str] = None
    card_last4: Optional[str] = None
    message: Optional[str] = None


class DetectInvoiceResponse(BaseModel):
    results: List[DetectInvoiceFileResult]


class PdfPasswordCheckResult(BaseModel):
    filename: str
    requires_password: bool


class PdfPasswordCheckResponse(BaseModel):
    results: List[PdfPasswordCheckResult]


def _pdf_user_message(exc: Exception) -> str:
    if isinstance(exc, PdfPasswordRequired):
        return "PDF protegido por senha"
    if isinstance(exc, PdfPasswordInvalid):
        return "Senha do PDF incorreta"
    return str(exc)


def _registered_credit_card_numbers(db: Session, tenant_id: int) -> set:
    query = db.query(Cartao.number).filter(
        Cartao.tenant_id == tenant_id,
        Cartao.active == True,
        Cartao.type == "credito",
    )
    return {
        MappingHelper.normalize_card_number(number)
        for (number,) in query.all()
        if number
    }


def _card_not_registered_error(last4: Optional[str] = None) -> HTTPException:
    hint = f" final {last4}" if last4 else ""
    return HTTPException(
        status_code=400,
        detail=(
            f"Nenhum lançamento foi salvo. Cadastre o cartão{hint} "
            "em Configurações > Cartões e tente novamente."
        ),
    )


def _persist_conversion_txt_files(txt_folder: str, original_filenames: List[str]) -> List[dict]:
    """Copia arquivos TXT de conversão PDF para armazenamento persistente."""
    if not os.path.isdir(txt_folder):
        return []

    txt_files = sorted(f for f in os.listdir(txt_folder) if f.endswith(".txt"))
    if not txt_files:
        return []

    os.makedirs(CONVERSION_TXT_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results = []

    for i, txt_name in enumerate(txt_files):
        src = os.path.join(txt_folder, txt_name)
        orig = original_filenames[i] if i < len(original_filenames) else txt_name
        safe_base = re.sub(r"[^\w\-_.]", "_", os.path.splitext(orig)[0])[:80]
        suffix = f"_{i}" if len(txt_files) > 1 else ""
        dest_name = f"{timestamp}{suffix}_{safe_base}.txt"
        dest_path = os.path.join(CONVERSION_TXT_DIR, dest_name)
        shutil.copy2(src, dest_path)
        results.append({
            "original_filename": orig,
            "download_filename": dest_name,
            "download_url": f"/api/import/cartao/conversion-txt/{dest_name}",
        })

    return results


@router.post("/extrato")
async def import_extrato(
    files: List[UploadFile] = File(...),
    account_id: Optional[int] = Form(None),
    enable_tracing: Optional[str] = Form("false"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Importa arquivos de extrato bancário (.xls ou .xlsx) e salva no banco de dados.

    Args:
        files: Lista de arquivos de extrato para processar
        account_id: ID da conta bancária (opcional - usa account_id do JWT se não fornecido)
        enable_tracing: Se "true", gera arquivo JSON com debug de cada linha processada
        db: Sessão do banco de dados

    Returns:
        JSON com estatísticas da importação
    """
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo fornecido")

    # Extrai user_id e tenant_id do token JWT
    tenant_id = current_user.get("tenant_id")
    user_id = current_user.get("user_id") or current_user.get("id")

    # Se account_id não foi fornecido, usa o account_id do JWT
    if account_id is None:
        account_id = current_user.get("account_id")
        if not account_id:
            raise HTTPException(
                status_code=400,
                detail="account_id não encontrado no token JWT. Por favor, selecione uma conta."
            )

    # Valida se o account_id pertence ao usuário logado
    account = db.query(Account).filter(
        Account.id == account_id,
        Account.user_id == user_id,
        Account.tenant_id == tenant_id,
        Account.active == True
    ).first()

    if not account:
        raise HTTPException(
            status_code=404,
            detail="Conta não encontrada ou não pertence ao usuário logado"
        )

    # Valida extensões
    for file in files:
        if not file.filename.endswith(('.xls', '.xlsx')):
            raise HTTPException(
                status_code=400,
                detail=f"Arquivo {file.filename} não é um arquivo Excel válido (.xls ou .xlsx)"
            )

    # Cria diretórios temporários
    temp_dir = tempfile.mkdtemp()
    input_dir = os.path.join(temp_dir, "input")
    output_dir = os.path.join(temp_dir, "output")
    os.makedirs(input_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    psycopg2_conn = None
    try:
        # Salva arquivos enviados
        file_paths = []
        for file in files:
            file_path = os.path.join(input_dir, file.filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            file_paths.append(file_path)

        # ========================================
        # PIPELINE ETL: Extract → Transform → Load
        # ========================================

        # Cria conexão psycopg2 para o MappingHelper
        psycopg2_conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        mapping_helper = MappingHelper(db_connection=psycopg2_conn, user_id=user_id, tenant_id=tenant_id, account_id=account_id)

        # Inicializa ETL
        etl = ExtratoETL(
            db_session=db,
            mapping_helper=mapping_helper,
            tenant_id=tenant_id
        )

        # Executa pipeline ETL (Extract + Transform) e retorna DataFrame
        result = etl.process(file_paths=file_paths, return_dataframe=True)

        if not result["success"]:
            raise HTTPException(
                status_code=400,
                detail=result.get("error", "Erro ao processar arquivos")
            )

        # Pega o DataFrame transformado
        df_transformed = result.get("dataframe")
        ignored_rows = result.get("ignored_rows") or []

        if df_transformed is None or (df_transformed.empty and not ignored_rows):
            raise HTTPException(status_code=400, detail="Nenhum dado foi processado")

        # Converte enable_tracing de string para boolean
        tracing_enabled = enable_tracing.lower() == "true" if enable_tracing else False

        # Lista de nomes de arquivos originais para o log de debug
        original_filenames = [f.filename for f in files]

        save_result = {
            "created": 0,
            "duplicates": 0,
            "skipped": 0,
            "unmapped": 0,
            "unmapped_records": [],
            "conflicts": [],
            "conflicts_count": 0,
        }
        if df_transformed is not None and not df_transformed.empty:
            # Usa a mesma função de insert/update do excel_import_router
            # detect_conflicts=True permite detectar mudanças de tag/subtag e valor
            save_result = save_extrato_records(
                df_transformed, db, tenant_id=tenant_id, account_id=account_id, user_id=user_id,
                detect_conflicts=True, enable_tracing=tracing_enabled, original_filenames=original_filenames
            )

        # Fecha conexão psycopg2
        psycopg2_conn.close()

        # Limpa diretório temporário
        shutil.rmtree(temp_dir, ignore_errors=True)

        # Retorna estatísticas
        return {
            "success": True,
            "message": "Extratos importados com sucesso via ETL",
            "arquivos_processados": result["arquivos_processados"],
            "linhas_salvas": save_result["created"],
            "linhas_atualizadas": save_result["duplicates"],
            "registros_atualizados_detalhe": save_result.get("updated_records", []),
            "linhas_com_erro": save_result["skipped"],
            "linhas_ignoradas_detalhe": save_result.get("skippedRows", []),
            "linhas_nao_mapeadas": save_result.get("unmapped", 0),
            "registros_nao_mapeados": save_result.get("unmapped_records", []),
            "conflicts": save_result.get("conflicts", []),
            "conflicts_count": save_result.get("conflicts_count", 0),
            "linhas_ignoradas_politica": ignored_rows,
            "linhas_ignoradas_politica_count": len(ignored_rows),
            "debug_data": save_result.get("debug_data")  # Dados de debug para salvar após resolução
        }

    except Exception as e:
        # Fecha conexão psycopg2 em caso de erro
        if psycopg2_conn:
            psycopg2_conn.close()
        # Limpa diretório temporário em caso de erro
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Erro ao processar extratos: {str(e)}")


@router.get("/cartao/conversion-txt/{filename}")
async def download_conversion_txt(
    filename: str,
    current_user: dict = Depends(require_account),
):
    """Download do arquivo TXT gerado na conversão de fatura PDF."""
    if not re.match(r"^[\w\-_.]+\.txt$", filename):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")

    file_path = os.path.join(CONVERSION_TXT_DIR, filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")

    return FileResponse(
        file_path,
        media_type="text/plain; charset=utf-8",
        filename=filename,
    )


@router.post("/pdf/check-passwords", response_model=PdfPasswordCheckResponse)
async def check_pdf_passwords(
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Indica quais PDFs exigem senha do usuário para leitura."""
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo fornecido")

    default_password = _account_default_pdf_password(db, current_user)
    temp_dir = tempfile.mkdtemp()
    results: List[PdfPasswordCheckResult] = []

    try:
        for file in files:
            filename = file.filename or "arquivo.pdf"
            if not filename.lower().endswith(".pdf"):
                results.append(PdfPasswordCheckResult(filename=filename, requires_password=False))
                continue

            safe_name = os.path.basename(filename)
            temp_path = os.path.join(temp_dir, safe_name)
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            try:
                requires = pdf_still_needs_user_password(
                    temp_path, default_password
                )
            except Exception as ex:
                logger.warning("Falha ao verificar senha do PDF %s: %s", filename, ex)
                requires = False

            results.append(PdfPasswordCheckResult(filename=filename, requires_password=requires))

        return PdfPasswordCheckResponse(results=results)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/cartao/detect", response_model=DetectInvoiceResponse)
async def detect_cartao_pdfs(
    files: List[UploadFile] = File(...),
    passwords: List[str] = Form([]),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Identifica se o PDF é fatura BTG ou Mercado Pago e extrai ano/mês quando possível."""
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo fornecido")

    default_password = _account_default_pdf_password(db, current_user)
    temp_dir = tempfile.mkdtemp()
    results: List[DetectInvoiceFileResult] = []

    try:
        for index, file in enumerate(files):
            filename = file.filename or "arquivo.pdf"
            if not filename.lower().endswith(".pdf"):
                results.append(
                    DetectInvoiceFileResult(
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
                inspected = inspect_invoice_pdf(temp_path, pdf_password, source_filename=filename)
                issuer = inspected.get("issuer") or "unknown"
                results.append(
                    DetectInvoiceFileResult(
                        filename=filename,
                        status="ok",
                        issuer=issuer,
                        issuer_label=inspected.get("issuer_label"),
                        year=inspected.get("year"),
                        month=inspected.get("month"),
                        card_last4=inspected.get("card_last4"),
                    )
                )
            except (PdfPasswordRequired, PdfPasswordInvalid) as ex:
                results.append(
                    DetectInvoiceFileResult(
                        filename=filename,
                        status="error",
                        message=_pdf_user_message(ex),
                    )
                )
            except Exception as ex:
                logger.warning("Falha ao identificar fatura %s: %s", filename, ex)
                results.append(
                    DetectInvoiceFileResult(
                        filename=filename,
                        status="error",
                        message="Não foi possível identificar o PDF da fatura",
                    )
                )

        return DetectInvoiceResponse(results=results)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/cartao")
async def import_cartao(
    files: List[UploadFile] = File(...),
    years: List[str] = Form(...),
    months: List[str] = Form(...),
    passwords: List[str] = Form([]),
    save_conversion_txt: Optional[str] = Form("false"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Importa arquivos de fatura de cartão de crédito (PDF).

    Os cartões são identificados automaticamente a partir do PDF e suas contas associadas são buscadas.
    Os mapeamentos são filtrados por user_id (usuário logado).

    Args:
        files: Lista de arquivos PDF de fatura para processar
        years: Lista de anos correspondentes a cada arquivo
        months: Lista de meses correspondentes a cada arquivo
        save_conversion_txt: Se "true", salva o TXT da conversão PDF para download

    Returns:
        Dados da importação (linhas salvas, atualizadas, não mapeadas)
    """
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo fornecido")

    if len(files) != len(years) or len(files) != len(months):
        raise HTTPException(
            status_code=400,
            detail="Número de arquivos, anos e meses deve ser igual"
        )

    # Valida extensões
    for file in files:
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400,
                detail=f"Arquivo {file.filename} não é um arquivo PDF válido"
            )

    # Cria diretórios temporários
    temp_dir = tempfile.mkdtemp()
    input_dir = os.path.join(temp_dir, "input")
    output_dir = os.path.join(temp_dir, "output")
    os.makedirs(input_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    try:
        # Salva arquivos enviados com ano e mês no nome
        file_paths = []
        file_years = []
        file_months = []
        file_passwords: List[Optional[str]] = []

        for i, file in enumerate(files):
            # Adiciona ano e mês ao nome do arquivo: "2017_09_Fatura Dez.pdf"
            base_name = os.path.splitext(file.filename)[0]
            new_filename = f"{years[i]}_{months[i]}_{base_name}.pdf"
            file_path = os.path.join(input_dir, new_filename)

            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            file_paths.append(file_path)
            file_years.append(years[i])
            file_months.append(months[i])

        # Processa arquivos
        # Extrai user_id, tenant_id e account_id do token JWT
        tenant_id = current_user.get("tenant_id")
        user_id = current_user.get("user_id") or current_user.get("id")
        account_id = current_user.get("account_id")
        default_password = _account_default_pdf_password(db, current_user)
        file_passwords = [
            resolve_pdf_password_at_index(passwords, i, default_password)
            for i in range(len(file_paths))
        ]

        # Cria conexão psycopg2 para o MappingHelper
        psycopg2_conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        mapping_helper = MappingHelper(db_connection=psycopg2_conn, user_id=user_id, tenant_id=tenant_id, account_id=account_id)
        converter = CartaoConverter(mapping_helper)
        keep_conversion_txt = save_conversion_txt.lower() == "true" if save_conversion_txt else False
        combined_df = converter.process_pdf_files(
            file_paths=file_paths,
            output_folder=output_dir,
            save_individually=False,
            save_temp_files=keep_conversion_txt,
            years=file_years,
            months=file_months,
            passwords=file_passwords,
        )

        conversion_txt_files = []
        if keep_conversion_txt:
            original_filenames = [f.filename for f in files]
            conversion_txt_files = _persist_conversion_txt_files(
                os.path.join(output_dir, "txt"),
                original_filenames,
            )

        if combined_df.empty:
            if combined_df.attrs.get("mp_empty_invoice"):
                last4 = combined_df.attrs.get("mp_card_last4")
                if not last4 and file_paths:
                    last4 = inspect_invoice_pdf(
                        file_paths[0],
                        file_passwords[0] if file_passwords else None,
                        source_filename=files[0].filename if files else None,
                    ).get("card_last4")
                registered = _registered_credit_card_numbers(db, tenant_id)
                if last4 and MappingHelper.normalize_card_number(last4) not in registered:
                    raise _card_not_registered_error(last4)
                if not last4 and not registered:
                    raise _card_not_registered_error()
                shutil.rmtree(temp_dir, ignore_errors=True)
                return {
                    "success": True,
                    "message": "Fatura sem compras para importar",
                    "empty_invoice": True,
                    "arquivos_processados": len(files),
                    "linhas_salvas": 0,
                    "linhas_atualizadas": 0,
                    "cartoes_distintos": 0,
                    "linhas_nao_mapeadas": 0,
                    "registros_nao_mapeados": [],
                    "conflicts": [],
                    "conflicts_count": 0,
                    "conversion_txt": conversion_txt_files,
                }
            if combined_df.attrs.get("mp_garbled"):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Não foi possível ler os lançamentos deste PDF do Mercado Pago. "
                        "A extração de texto da fonte do arquivo veio corrompida."
                    ),
                )
            detail_msg = explain_empty_cartao_import_batch(
                file_paths,
                [f.filename or os.path.basename(p) for f, p in zip(files, file_paths)],
                file_passwords,
                file_years,
                file_months,
                mapping_helper,
                output_dir,
            )
            logger.warning("Importação cartão sem dados: %s", detail_msg.replace("\n", " | "))
            raise HTTPException(status_code=400, detail=detail_msg)

        # Salva faturas no banco de dados
        account_id = current_user.get("account_id")
        stats = FaturaService.salvar_faturas_do_dataframe(db, combined_df, tenant_id, user_id, account_id)

        if stats.get("cartoes_distintos", 0) == 0:
            cards = sorted({
                str(c)[-4:] for c in combined_df.get("Cartão", pd.Series(dtype=str)).dropna().unique() if str(c).strip()
            })
            raise _card_not_registered_error(" / ".join(cards) if cards else None)

        # Limpa diretório temporário
        shutil.rmtree(temp_dir, ignore_errors=True)

        # Retorna mensagem de sucesso com estatísticas corretas
        conflicts = stats.get('conflicts', [])
        return {
            "success": True,
            "message": "Faturas importadas com sucesso!" if len(conflicts) == 0 else "Importação com conflitos pendentes",
            "arquivos_processados": len(files),
            "linhas_salvas": stats['linhas_salvas'],
            "linhas_atualizadas": stats['linhas_atualizadas'],
            "cartoes_distintos": stats['cartoes_distintos'],
            "linhas_nao_mapeadas": stats.get('linhas_nao_mapeadas', 0),
            "registros_nao_mapeados": stats.get('registros_nao_mapeados', []),
            "conflicts": conflicts,
            "conflicts_count": len(conflicts),
            "conversion_txt": conversion_txt_files,
        }

    except HTTPException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as e:
        # Limpa diretório temporário em caso de erro
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Erro ao processar faturas: {str(e)}")


def _save_debug_json(debug_data: dict, resolution_info: dict = None):
    """
    Salva o arquivo JSON de debug com informações de resolução.

    Args:
        debug_data: Dados de debug da importação
        resolution_info: Informações sobre a resolução (aceitos, rejeitados, descartados)
    """
    import json

    if not debug_data:
        return

    # Adiciona informações de resolução
    if resolution_info:
        debug_data["resolution"] = resolution_info

    try:
        # Caminho: routers → app → backend → logs
        log_dir = os.path.join(os.path.dirname(__file__), "..", "..", "logs")
        os.makedirs(log_dir, exist_ok=True)
        log_file = os.path.join(log_dir, f"import_debug_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        with open(log_file, "w", encoding="utf-8") as f:
            json.dump(debug_data, f, indent=2, ensure_ascii=False, default=str)
        logger.info(f"📝 Debug JSON salvo em: {log_file}")
    except Exception as e:
        logger.warning(f"⚠️ Erro ao salvar debug JSON: {e}")


@router.post("/resolve-conflicts")
async def resolve_import_conflicts(
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Resolve conflitos de importação (tag/subtag e/ou valor).

    Recebe uma lista de resoluções e aplica as mudanças aceitas.

    Body:
    {
        "resolutions": [
            {
                "existing_id": 123,
                "record_type": "bank_statement",  // ou "credit_card_invoice" ou "benefit_card_statement"
                "accept_tag_change": true,
                "accept_amount_change": false,
                "new_subtag_id": 45,
                "new_amount": 150.00
            },
            ...
        ],
        "debug_data": { ... }  // Opcional - dados de debug para salvar
    }
    """
    from ..models.unified_models import BankStatement, CreditCardInvoice, BenefitCardStatement
    from decimal import Decimal

    body = await request.json()
    resolutions = body.get("resolutions", [])
    debug_data = body.get("debug_data")

    if not resolutions:
        # Se há debug_data mas não há resoluções, salva o JSON assim mesmo
        if debug_data:
            _save_debug_json(debug_data, {"status": "no_conflicts", "message": "Nenhum conflito para resolver"})
        return {"success": True, "updated": 0, "message": "Nenhuma resolução para processar"}

    tenant_id = current_user.get("tenant_id")
    updated_count = 0
    accepted_tags = 0
    accepted_amounts = 0
    rejected_tags = 0
    rejected_amounts = 0
    errors = []

    for resolution in resolutions:
        try:
            existing_id = resolution.get("existing_id")
            record_type = resolution.get("record_type")
            accept_tag = resolution.get("accept_tag_change", False)
            accept_amount = resolution.get("accept_amount_change", False)
            selected_from_multiple = resolution.get("selected_from_multiple", False)

            # DEBUG: Log da resolução recebida
            if selected_from_multiple:
                logger.info(f"📝 [RESOLVE] #{existing_id} ({record_type}) - SELECIONADO DE MÚLTIPLOS MATCHES")
            else:
                logger.info(f"📝 [RESOLVE] #{existing_id} ({record_type})")
            logger.info(f"   accept_tag={accept_tag}, accept_amount={accept_amount}")
            logger.info(f"   new_subtag_id={resolution.get('new_subtag_id')}, new_amount={resolution.get('new_amount')}")

            # Validação: se selected_from_multiple, o ID deve ser válido
            if selected_from_multiple and (not existing_id or existing_id == 0):
                errors.append(f"Resolução inválida: múltiplos matches sem seleção de registro")
                continue

            if not existing_id or not record_type:
                errors.append(f"Resolução inválida: missing existing_id ou record_type")
                continue

            # Busca o registro
            if record_type == "bank_statement":
                record = db.query(BankStatement).filter(
                    BankStatement.id == existing_id,
                    BankStatement.tenant_id == tenant_id
                ).first()
            elif record_type == "credit_card_invoice":
                record = db.query(CreditCardInvoice).filter(
                    CreditCardInvoice.id == existing_id,
                    CreditCardInvoice.tenant_id == tenant_id
                ).first()
            elif record_type == "benefit_card_statement":
                record = db.query(BenefitCardStatement).filter(
                    BenefitCardStatement.id == existing_id,
                    BenefitCardStatement.tenant_id == tenant_id
                ).first()
            else:
                errors.append(f"Tipo de registro desconhecido: {record_type}")
                continue

            if not record:
                errors.append(f"Registro não encontrado: {record_type} #{existing_id}")
                continue

            # Aplica as mudanças aceitas e conta estatísticas
            if resolution.get("new_subtag_id") is not None:
                if accept_tag:
                    logger.info(f"   ✅ Aplicando tag: {record.subtag_id} → {resolution['new_subtag_id']}")
                    record.subtag_id = resolution["new_subtag_id"]
                    accepted_tags += 1
                else:
                    logger.info(f"   ❌ Tag rejeitada (mantendo {record.subtag_id})")
                    rejected_tags += 1

            if resolution.get("new_amount") is not None:
                if accept_amount:
                    logger.info(f"   ✅ Aplicando amount: {record.amount} → {resolution['new_amount']}")
                    record.amount = Decimal(str(resolution["new_amount"]))
                    accepted_amounts += 1
                else:
                    logger.info(f"   ❌ Amount rejeitado (mantendo {record.amount})")
                    rejected_amounts += 1

            updated_count += 1

        except Exception as e:
            errors.append(f"Erro ao processar resolução: {str(e)}")

    db.commit()

    # Salva o JSON de debug com informações de resolução
    if debug_data:
        # Atualiza status dos registros em all_records de CONFLITO para RESOLVIDO
        resolved_ids = {r.get("existing_id") for r in resolutions}
        if debug_data.get("all_records"):
            for record in debug_data["all_records"]:
                if record.get("status") == "CONFLITO":
                    record["status"] = "RESOLVIDO"

        _save_debug_json(debug_data, {
            "status": "resolved",
            "total_conflicts": len(resolutions),
            "accepted_tags": accepted_tags,
            "rejected_tags": rejected_tags,
            "accepted_amounts": accepted_amounts,
            "rejected_amounts": rejected_amounts,
            "errors": errors
        })

    return {
        "success": True,
        "updated": updated_count,
        "errors": errors,
        "message": f"{updated_count} registro(s) atualizado(s) com sucesso"
    }


@router.post("/save-debug")
async def save_import_debug(
    request: Request,
    current_user: dict = Depends(require_account)
):
    """
    Salva o arquivo JSON de debug quando conflitos são descartados.

    Body:
    {
        "debug_data": { ... },
        "discarded_count": 5,
        "reason": "user_cancelled"
    }
    """
    body = await request.json()
    debug_data = body.get("debug_data")
    discarded_count = body.get("discarded_count", 0)
    reason = body.get("reason", "unknown")

    if not debug_data:
        return {"success": False, "message": "Nenhum dado de debug fornecido"}

    # Atualiza all_records com status DESCARTADO para os conflitos
    if debug_data.get("all_records"):
        for record in debug_data["all_records"]:
            if record.get("status") == "CONFLITO":
                record["status"] = "DESCARTADO"

    _save_debug_json(debug_data, {
        "status": "discarded",
        "discarded_count": discarded_count,
        "reason": reason,
        "message": f"{discarded_count} conflito(s) descartado(s) pelo usuário"
    })

    return {"success": True, "message": f"Debug JSON salvo com {discarded_count} conflito(s) descartado(s)"}

