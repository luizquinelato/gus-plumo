# -*- coding: utf-8 -*-
import logging
import os
import re
from typing import List, Optional, Dict, Any
import pandas as pd
from ..utils.import_progress import report_row_progress
from ..utils.mapping_helper import MappingHelper
from ..utils.pdf_password import open_pdf_reader
from .fatura_pdf import (
    detect_invoice_issuer,
    invoice_period_from_filename,
    normalize_invoice_issuer,
    parse_mercadopago_invoice,
    resolve_btg_import_period,
    resolve_mercadopago_import_period,
)

logger = logging.getLogger(__name__)

MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]

FOREIGN_MOEDAS_BRL = frozenset({"US$", "EUR"})


class CartaoConverter:
    def __init__(self, mapping_helper: Optional[MappingHelper] = None):
        self.mapping_helper = mapping_helper or MappingHelper()
    
    def process_pdf_files(self, file_paths: List[str], output_folder: str,
                          save_individually: bool = False, save_temp_files: bool = False,
                          years: List[str] = None, months: List[str] = None,
                          passwords: Optional[List[str]] = None) -> pd.DataFrame:
        txt_folder = os.path.join(output_folder, "txt")
        txt_files = self._pdf_to_txt(file_paths, txt_folder, passwords=passwords)
        all_data = []

        for i, txt_file in enumerate(txt_files):
            # Passa ano e mês específicos se fornecidos
            year_override = years[i] if years and i < len(years) else None
            month_override = months[i] if months and i < len(months) else None

            with open(txt_file, "r", encoding="utf-8") as f:
                raw_text = f.read()
            issuer = detect_invoice_issuer(raw_text)
            if not year_override or not month_override:
                basename = (
                    os.path.basename(file_paths[i]) if i < len(file_paths) else None
                )
                resolved_issuer = issuer if issuer != "unknown" else "btg"
                if resolved_issuer == "btg":
                    file_year, file_month = resolve_btg_import_period(raw_text, basename)
                elif resolved_issuer == "mercadopago":
                    file_path = file_paths[i] if i < len(file_paths) else basename
                    file_year, file_month = resolve_mercadopago_import_period(
                        raw_text, file_path
                    )
                else:
                    file_year, file_month = invoice_period_from_filename(basename)
                year_override = year_override or file_year
                month_override = month_override or file_month

            if issuer == "mercadopago":
                if not year_override or not month_override:
                    raise ValueError("Fatura Mercado Pago requer ano e mês para importação")
                pdf_pwd = passwords[i] if passwords and i < len(passwords) else None
                parsed = parse_mercadopago_invoice(
                    raw_text,
                    year_override,
                    month_override,
                    self.mapping_helper,
                    pdf_path=file_paths[i] if i < len(file_paths) else None,
                    pdf_password=pdf_pwd,
                )
                df = pd.DataFrame(parsed.rows)
                df.attrs["mp_empty_invoice"] = parsed.empty_invoice
                df.attrs["mp_garbled"] = parsed.garbled
                df.attrs["mp_card_last4"] = parsed.card_last4
                logger.info(
                    "PDF %s identificado como Mercado Pago (%s lançamentos, empty=%s, garbled=%s)",
                    txt_file,
                    len(df),
                    parsed.empty_invoice,
                    parsed.garbled,
                )
            else:
                df = self._txt_to_excel_line_by_line(
                    [txt_file],
                    output_folder,
                    save_individually,
                    year_override=year_override,
                    month_override=month_override,
                )
            if not df.empty:
                df["Emissor"] = normalize_invoice_issuer(issuer)
            all_data.append(df)
            # Remove arquivo .txt temporário se save_temp_files=False
            if not save_temp_files and os.path.exists(txt_file):
                os.remove(txt_file)

        # Remove pasta txt se estiver vazia e save_temp_files=False
        if not save_temp_files and os.path.exists(txt_folder):
            try:
                if not os.listdir(txt_folder):  # Verifica se está vazia
                    os.rmdir(txt_folder)
            except Exception:
                pass  # Ignora erros ao remover pasta

        if all_data:
            combined_df = pd.concat(all_data, ignore_index=True)
            if combined_df.empty:
                combined_df.attrs["mp_empty_invoice"] = any(
                    bool(frame.attrs.get("mp_empty_invoice")) for frame in all_data
                )
                combined_df.attrs["mp_garbled"] = any(
                    bool(frame.attrs.get("mp_garbled")) for frame in all_data
                )
                last4s = [
                    frame.attrs.get("mp_card_last4")
                    for frame in all_data
                    if frame.attrs.get("mp_card_last4")
                ]
                combined_df.attrs["mp_card_last4"] = last4s[0] if last4s else None
            return combined_df
        return pd.DataFrame()
    
    @staticmethod
    def _pdf_to_txt(
        file_paths: List[str],
        txt_folder: str,
        passwords: Optional[List[str]] = None,
    ) -> List[str]:
        os.makedirs(txt_folder, exist_ok=True)
        txt_files = []

        for i, pdf_path in enumerate(file_paths):
            filename = os.path.basename(pdf_path)
            base_name = os.path.splitext(filename)[0]
            parent_folder = os.path.basename(os.path.dirname(pdf_path))
            
            if parent_folder.isdigit() and len(parent_folder) == 4:
                year = parent_folder
            else:
                year_match = re.search(r'20\d{2}', base_name)
                year = year_match.group() if year_match else "2024"
            
            txt_filename = f"{base_name} {year}.txt"
            txt_path = os.path.join(txt_folder, txt_filename)
            txt_files.append(txt_path)

            pwd = passwords[i] if passwords and i < len(passwords) else None
            with open(txt_path, "w", encoding="utf-8") as txt:
                reader = open_pdf_reader(pdf_path, pwd)
                page_total = len(reader.pages) or 1
                report_row_progress(0, page_total, phase=0)
                for page_index, page in enumerate(reader.pages, start=1):
                    txt.write(page.extract_text() or "")
                    txt.write("\n")
                    report_row_progress(page_index, page_total, phase=0)
            print(f"Converted {pdf_path} to {txt_path}")

        return txt_files
    
    @staticmethod
    def limpar_descricao(descricao: str) -> str:
        return re.sub(r'\s*\(.*?\)', '', descricao)

    @staticmethod
    def _moeda_parser_flags(moeda: str) -> Dict[str, Any]:
        m = moeda.upper()
        return {
            "dollar": m == "US$",
            "needs_brl_conversion": m in FOREIGN_MOEDAS_BRL,
        }

    @staticmethod
    def parse_linha_lancamento_completa(line: str) -> Optional[Dict[str, Any]]:
        """
        Parse linhas completas de lançamento no formato comum do PDF:
        '15 Jan LOJA X (2/12) R$ 100,00'
        """
        line = line.strip()
        if not line:
            return None

        if CartaoConverter.parse_linha_lancamento_credito_dash(line):
            return None
        if re.search(r"[-–—−]\s*(R\$|US\$)", line, re.IGNORECASE):
            return None

        match = re.match(
            r'^(\d{1,2})\s+([A-Za-z]{3})\s+(.+?)\s+(R\$|US\$)\s*([\d.,]+)\s*$',
            line,
            re.IGNORECASE,
        )
        if not match:
            return None

        dia, mes_abbr, descricao, moeda, valor_str = match.groups()
        valor = float(valor_str.replace('.', '').replace(',', '.'))
        descricao = descricao.strip().rstrip("-").strip()

        return {
            'data': f"{dia} {mes_abbr}",
            'descricao': descricao,
            'descricao_simples': CartaoConverter.limpar_descricao(descricao),
            'valor': valor,
            'dollar': moeda.upper() == 'US$',
        }

    @staticmethod
    def parse_linha_lancamento_desc_valor(line: str, date_prefix: str) -> Optional[Dict[str, Any]]:
        """BTG+ resumo: data na linha anterior + 'Loja R$ 10,00'."""
        line = line.strip()
        if not line or not date_prefix:
            return None

        credit_match = re.match(
            r"(.+?)\s*[-–—−]\s*(R\$|US\$|EUR)\s*([\d.,]+)\s*$",
            line,
            re.IGNORECASE,
        )
        if credit_match:
            descricao, moeda, valor_str = credit_match.groups()
            valor = -float(valor_str.replace(".", "").replace(",", "."))
            descricao = descricao.strip().rstrip("-").strip()
            flags = CartaoConverter._moeda_parser_flags(moeda)
            return {
                "data": date_prefix.strip(),
                "descricao": descricao,
                "descricao_simples": CartaoConverter.limpar_descricao(descricao),
                "valor": valor,
                **flags,
            }

        match = re.match(
            r"(.+?)\s+(R\$|US\$|EUR)\s*([\d.,]+)\s*$",
            line,
            re.IGNORECASE,
        )
        if not match:
            return None
        descricao, moeda, valor_str = match.group(1), match.group(2), match.group(3)
        valor = float(valor_str.replace(".", "").replace(",", "."))
        descricao = descricao.strip()
        flags = CartaoConverter._moeda_parser_flags(moeda)
        return {
            "data": date_prefix.strip(),
            "descricao": descricao,
            "descricao_simples": CartaoConverter.limpar_descricao(descricao),
            "valor": valor,
            **flags,
        }

    @staticmethod
    def parse_linha_lancamento_valor_desc(line: str) -> Optional[Dict[str, Any]]:
        """
        BTG+ (2022+): valor e descrição na linha, data na linha seguinte.
        'R$ 350,75 Auto Posto Xurunga'
        """
        line = line.strip()
        if not line or line.startswith("-"):
            return None
        if re.match(r"^\d{1,2}\s+[A-Za-z]{3}\b", line, re.IGNORECASE):
            return None
        if CartaoConverter.parse_linha_lancamento_valor_primeiro(line):
            return None
        match = re.match(
            r"^(R\$|US\$|EUR)\s*([\d.,]+)\s+(.+)$",
            line,
            re.IGNORECASE,
        )
        if not match:
            return None
        moeda, valor_str, descricao = match.groups()
        descricao = descricao.strip()
        if not descricao:
            return None
        flags = CartaoConverter._moeda_parser_flags(moeda)
        return {
            "data": None,
            "descricao": descricao,
            "descricao_simples": CartaoConverter.limpar_descricao(descricao),
            "valor": float(valor_str.replace(".", "").replace(",", ".")),
            **flags,
        }

    @staticmethod
    def parse_linha_lancamento_data_moeda_desc(line: str) -> Optional[Dict[str, Any]]:
        """'07 Abr R$ 416,61 Submarino (1/10)'"""
        line = line.strip()
        if not line:
            return None
        match = re.match(
            r"^(\d{1,2})\s+([A-Za-z]{3})\s+(R\$|US\$|EUR)\s*([\d.,]+)\s+(.+)$",
            line,
            re.IGNORECASE,
        )
        if not match:
            return None
        dia, mes_abbr, moeda, valor_str, descricao = match.groups()
        flags = CartaoConverter._moeda_parser_flags(moeda)
        return {
            "data": f"{dia} {mes_abbr}",
            "descricao": descricao.strip(),
            "descricao_simples": CartaoConverter.limpar_descricao(descricao.strip()),
            "valor": float(valor_str.replace(".", "").replace(",", ".")),
            **flags,
        }

    @staticmethod
    def _split_btg_credit_embedded_dupe(descricao: str) -> tuple[str, Optional[str]]:
        """'Benefício ... 26 Abr-R$ 241,99' -> ('Benefício ...', '26 Abr')."""
        months_pattern = "|".join(MONTHS)
        match = re.search(
            rf"\s+(\d{{1,2}}\s+(?:{months_pattern}))-\s*R\$\s*[\d.,]+\s*$",
            descricao,
            re.IGNORECASE,
        )
        if not match:
            return descricao, None
        return descricao[: match.start()].strip(), match.group(1)

    @staticmethod
    def parse_linha_lancamento_credito_valor_desc(line: str) -> Optional[Dict[str, Any]]:
        """'- R$ 350,75 Cancelamento - Auto Posto' (data na linha seguinte ou no fim)."""
        line = line.strip()
        months_pattern = "|".join(MONTHS)
        match_embedded = re.match(
            rf"^-\s*(R\$|US\$)\s*([\d.,]+)\s+(.+?)\s+(\d{{1,2}})\s+({months_pattern})-\s*R\$\s*([\d.,]+)\s*$",
            line,
            re.IGNORECASE,
        )
        if match_embedded:
            moeda, valor_str, descricao, dia, mes_abbr, _dupe_val = (
                match_embedded.groups()
            )
            descricao = descricao.strip().rstrip("-").strip()
            return {
                "data": f"{dia} {mes_abbr}",
                "descricao": descricao,
                "descricao_simples": CartaoConverter.limpar_descricao(descricao),
                "valor": -float(valor_str.replace(".", "").replace(",", ".")),
                "dollar": moeda.upper() == "US$",
            }
        match_data_fim = re.match(
            rf"^-\s*(R\$|US\$)\s*([\d.,]+)\s+(.+?)\s+(\d{{1,2}})\s+({months_pattern})\s*$",
            line,
            re.IGNORECASE,
        )
        if match_data_fim:
            moeda, valor_str, descricao, dia, mes_abbr = match_data_fim.groups()
            descricao = descricao.strip().rstrip("-").strip()
            return {
                "data": f"{dia} {mes_abbr}",
                "descricao": descricao,
                "descricao_simples": CartaoConverter.limpar_descricao(descricao),
                "valor": -float(valor_str.replace(".", "").replace(",", ".")),
                "dollar": moeda.upper() == "US$",
            }
        match = re.match(
            r"^-\s*(R\$|US\$)\s*([\d.,]+)\s+(.+)$",
            line,
            re.IGNORECASE,
        )
        if not match:
            return None
        moeda, valor_str, descricao = match.groups()
        descricao = descricao.strip().rstrip("-").strip()
        descricao, data_embedded = CartaoConverter._split_btg_credit_embedded_dupe(
            descricao
        )
        return {
            "data": data_embedded,
            "descricao": descricao,
            "descricao_simples": CartaoConverter.limpar_descricao(descricao),
            "valor": -float(valor_str.replace(".", "").replace(",", ".")),
            "dollar": moeda.upper() == "US$",
        }

    @staticmethod
    def _is_btg_credit_summary_dupe_line(stripped: str) -> bool:
        """'03 Abr-R$ 350,75' — detalhe duplicado após crédito."""
        return bool(
            re.fullmatch(
                r"\d{1,2}\s+[A-Za-z]{3}-\s*R\$\s*[\d.,]+\s*$",
                stripped,
                re.IGNORECASE,
            )
        )

    @staticmethod
    def _btg_date_from_credit_summary_dupe(stripped: str) -> Optional[str]:
        match = re.match(
            r"(\d{1,2}\s+[A-Za-z]{3})-\s*R\$",
            stripped,
            re.IGNORECASE,
        )
        return match.group(1) if match else None

    @staticmethod
    def _split_btg_multi_credito_line(line: str) -> list[str]:
        """
        PDFs BTG colam vários créditos na mesma linha:
        '- R$ 201,89 Benefício ... 25 Jan - R$ 7,30 Cancelamento ...'
        """
        stripped = (line or "").strip()
        if not stripped.startswith("-"):
            return [stripped] if stripped else []
        markers = list(
            re.finditer(r"-\s*(?:R\$|US\$)\s*[\d.,]+", stripped, re.IGNORECASE)
        )
        if len(markers) <= 1:
            return [stripped]
        parts: list[str] = []
        for idx, match in enumerate(markers):
            start = match.start()
            end = markers[idx + 1].start() if idx + 1 < len(markers) else len(stripped)
            part = stripped[start:end].strip()
            if part:
                parts.append(part)
        return parts or [stripped]

    @staticmethod
    def _parse_btg_credito_linha(line: str) -> Optional[Dict[str, Any]]:
        """Créditos BTG: '- R$ X Desc' ou '17 Mar Crédito ... - R$ X'."""
        return (
            CartaoConverter.parse_linha_lancamento_credito_dash(line)
            or CartaoConverter.parse_linha_lancamento_credito_valor_desc(line)
        )

    @staticmethod
    def parse_linha_lancamento_valor_primeiro(line: str) -> Optional[Dict[str, Any]]:
        """
        Parse linhas no formato inverso comum em alguns PDFs:
        'R$ 663,60 Eventim (3/3) 19 Mar'
        """
        line = line.strip()
        if not line:
            return None

        months_pattern = "|".join(MONTHS)
        match = re.match(
            rf"^(R\$|US\$)\s*([\d.,]+)\s+(.+?)\s+(\d{{1,2}})\s+({months_pattern})\s*$",
            line,
            re.IGNORECASE,
        )
        if not match:
            return None

        moeda, valor_str, descricao, dia, mes_abbr = match.groups()
        valor = float(valor_str.replace(".", "").replace(",", "."))

        return {
            "data": f"{dia} {mes_abbr}",
            "descricao": descricao.strip(),
            "descricao_simples": CartaoConverter.limpar_descricao(descricao.strip()),
            "valor": valor,
            "dollar": moeda.upper() == "US$",
        }

    @staticmethod
    def parse_linha_lancamento_credito_dash(line: str) -> Optional[Dict[str, Any]]:
        """
        Créditos/estornos BTG: '17 Mar Crédito em confiança btg+ - R$ 272,62'
        """
        line = line.strip()
        if not line:
            return None
        match = re.match(
            r"^(\d{1,2})\s+([A-Za-z]{3})\s+(.+?)\s*[-–—−]\s*(R\$|US\$)\s*([\d.,]+)\s*$",
            line,
            re.IGNORECASE,
        )
        if not match:
            return None
        dia, mes_abbr, descricao, moeda, valor_str = match.groups()
        valor = -float(valor_str.replace(".", "").replace(",", "."))
        descricao = descricao.strip()
        return {
            "data": f"{dia} {mes_abbr}",
            "descricao": descricao,
            "descricao_simples": CartaoConverter.limpar_descricao(descricao),
            "valor": valor,
            "dollar": moeda.upper() == "US$",
        }

    @staticmethod
    def _parse_linha_lancamento_estruturada(
        line: str, pending_date_line: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        credit_valor = CartaoConverter.parse_linha_lancamento_credito_valor_desc(
            line
        )
        return (
            CartaoConverter.parse_linha_lancamento_credito_dash(line)
            or (credit_valor if credit_valor and credit_valor.get("data") else None)
            or CartaoConverter.parse_linha_lancamento_data_moeda_desc(line)
            or CartaoConverter.parse_linha_lancamento_completa(line)
            or CartaoConverter.parse_linha_lancamento_valor_primeiro(line)
            or (
                CartaoConverter.parse_linha_lancamento_desc_valor(line, pending_date_line)
                if pending_date_line
                else None
            )
        )

    @staticmethod
    def _is_card_subtotal_line(stripped: str) -> bool:
        return bool(
            re.fullmatch(r"R\$\s*[\d.,]+", stripped, re.IGNORECASE)
            or re.fullmatch(r"-R\$\s*[\d.,]+", stripped, re.IGNORECASE)
        )

    @staticmethod
    def _is_btg_currency_conversion_noise(stripped: str) -> bool:
        if not stripped:
            return False
        if "da moeda" in stripped.lower() or stripped.lower().startswith("cotação"):
            return True
        if re.search(r"conversão para real", stripped, re.IGNORECASE):
            return True
        return False

    @staticmethod
    def _read_brl_after_usd_purchase(lines_iter) -> tuple[Optional[float], str]:
        """
        Após 'Loja US$ X', o PDF BTG traz cotação/conversão e depois uma linha só 'R$ 616,52'.
        Retorna (valor em reais, próxima linha para o loop principal).

        A conversão pode vir na página seguinte (subtotal do cartão e rodapé no meio).
        Nesse caso devolve (None, primeira linha de compra BRL) para o loop principal.
        """
        months_pattern = "|".join(MONTHS)
        in_conversion = False
        while True:
            try:
                ln = next(lines_iter).strip()
            except StopIteration:
                return None, ""
            if not ln:
                continue
            if re.match(
                rf"^(\d{{1,2}}\s+(?:{months_pattern}))Cotação",
                ln,
                re.IGNORECASE,
            ):
                in_conversion = True
                continue
            if re.match(r"^\d{1,2}\s+[A-Za-z]{3}$", ln, re.IGNORECASE):
                continue
            if CartaoConverter._is_btg_page_break_noise(ln):
                continue
            if CartaoConverter._is_btg_currency_conversion_noise(ln):
                in_conversion = True
                continue
            # Subtotal "R$ X" só fora do bloco de cotação; conversão também é linha só com R$.
            if CartaoConverter._is_card_subtotal_line(ln) and not in_conversion:
                continue
            brl_only = re.fullmatch(
                r"R\$\s*([\d.,]+)\s*$", ln, re.IGNORECASE
            )
            brl_leading = re.match(
                r"^R\$\s*([\d.,]+)\s*(.*)$", ln, re.IGNORECASE
            )
            if brl_only or (
                brl_leading
                and brl_leading.group(1)
                and not (brl_leading.group(2) or "").strip()
            ):
                if not in_conversion:
                    return None, ln
                amount = (
                    brl_only.group(1)
                    if brl_only
                    else brl_leading.group(1)
                )
                valor = float(amount.replace(".", "").replace(",", "."))
                try:
                    next_line = next(lines_iter).strip()
                except StopIteration:
                    next_line = ""
                return valor, next_line
            dual_brl = re.match(
                r"^R\$\s*([\d.,]+)\s*R\$\s*([\d.,]+)",
                ln,
                re.IGNORECASE,
            )
            if in_conversion and dual_brl:
                valor = float(
                    dual_brl.group(1).replace(".", "").replace(",", ".")
                )
                try:
                    next_line = next(lines_iter).strip()
                except StopIteration:
                    next_line = ""
                return valor, next_line
            if brl_leading and (brl_leading.group(2) or "").strip():
                return None, ln
            if not in_conversion:
                return None, ln

    @staticmethod
    def _is_btg_page_break_noise(stripped: str) -> bool:
        """Rodapé/cabeçalho repetido entre páginas — não encerra lançamentos do cartão."""
        if not stripped:
            return False
        low = stripped.lower()
        if stripped.startswith("CNPJ"):
            return True
        if stripped.startswith("BTG Pactual"):
            return True
        if "brigadeiro faria lima" in low:
            return True
        if stripped.startswith("São Paulo") and "brasil" in low:
            return True
        if stripped.startswith("Olá,") or stripped.startswith("Olá "):
            return True
        if "esta é a fatura do seu cartão" in low:
            return True
        if "no valor a pagar" in low and "fatura de" in low:
            return True
        if stripped.startswith("Black de") and "valor" in low:
            return True
        if stripped in ("Essa fatura está em", "débito automático"):
            return True
        if re.search(r"fatura de\s+\w+\s*\|\s*cart[aã]o final", stripped, re.IGNORECASE):
            return True
        return False

    @staticmethod
    def separar_linhas_duplicadas(line: str) -> List[str]:
        pattern = r'(\d{1,2}\s+[A-Za-z]{3})(-\s*R\$)'
        matches = list(re.finditer(pattern, line))
        
        if not matches:
            return [line]
        
        lines = []
        start = 0
        
        for match in matches:
            end_of_date = match.end(1)
            first_transaction = line[start:end_of_date].strip()
            if first_transaction:
                lines.append(first_transaction)
            start = match.start(2)
        
        if start < len(line):
            last_transaction = line[start:].strip()
            if last_transaction:
                lines.append(last_transaction)
        
        return lines

    @staticmethod
    def preprocessar_linha(content: str) -> str:
        """
        Pre-processa o conteudo para separar transacoes concatenadas.

        Problemas comuns no PDF:
        1. Data colada com R$ da proxima transacao: "19 JanR$ 176,45" -> "19 Jan\nR$ 176,45"
        2. Data colada com total: "24 JanR$ 456,32" -> "24 Jan\nR$ 456,32"
        3. Multiplas transacoes (valor primeiro): "R$ 663,60 ... 19 Mar R$ 821,60" -> quebra entre elas
        4. Valor colado com data: "100,0015 Jan" -> "100,00\n15 Jan"

        Args:
            content: Conteudo de texto do PDF

        Returns:
            Conteudo pre-processado com quebras de linha onde necessario
        """
        months_pattern = "|".join(MONTHS)

        # Data seguida de nova transacao R$/US$ na mesma linha (formato valor primeiro)
        # Ex: "R$ 663,60 Eventim (3/3) 19 Mar R$ 821,60" -> "... 19 Mar\nR$ 821,60"
        content = re.sub(
            rf"(\d{{1,2}}\s+(?:{months_pattern}))\s+(R\$|US\$|EUR)",
            r"\1\n\2",
            content,
            flags=re.IGNORECASE,
        )

        # Padrao: DD Mmm colado com R$ ou US$ (sem espaco)
        # Ex: "19 JanR$ 176,45" -> "19 Jan\nR$ 176,45"
        content = re.sub(
            rf"(\d{{1,2}}\s+(?:{months_pattern}))(R\$|US\$|EUR)",
            r"\1\n\2",
            content,
            flags=re.IGNORECASE,
        )

        # Valor monetario colado com data na mesma linha (somente meses validos)
        # Ex: "100,0015 Jan" -> "100,00\n15 Jan"  (nao quebra "19 Mar" em "1" + "9 Mar")
        content = re.sub(
            rf"(\d+,\d{{2}})(\d{{1,2}}\s+(?:{months_pattern}))",
            r"\1\n\2",
            content,
            flags=re.IGNORECASE,
        )

        # BTG+ antigo: valor colado com "Lançamentos com..."
        content = re.sub(
            r"(\d+,\d{2})(Lançamentos com)",
            r"\1\n\2",
            content,
            flags=re.IGNORECASE,
        )
        content = re.sub(
            r"(R\$[\d.,]+)(Lançamentos com)",
            r"\1\n\2",
            content,
            flags=re.IGNORECASE,
        )
        # Dois lançamentos colados: "R$ 48,25R$ 3,08 IOF ..."
        content = re.sub(
            r"(R\$[\d.,]+)(R\$)",
            r"\1\n\2",
            content,
            flags=re.IGNORECASE,
        )

        content = re.sub(
            r"(Total de compras e despesas(?:\s+R\$[\d.,]+)?)(Total de compras e despesas)",
            r"\1\n\2",
            content,
            flags=re.IGNORECASE,
        )

        # Data colada em "Cotação da moeda" (ex.: "04 DezCotação da moeda -")
        content = re.sub(
            rf"(\d{{1,2}}\s+(?:{months_pattern}))Cotação",
            r"\1\nCotação",
            content,
            flags=re.IGNORECASE,
        )

        # Conversão BRL + IOF colados: "R$ 48,25R$ 3,08 IOF..."
        content = re.sub(
            r"(R\$\s*[\d.,]+)(R\$\s*)",
            r"\1\n\2",
            content,
            flags=re.IGNORECASE,
        )

        return content

    @staticmethod
    def _card_last4_from_lancamentos_line(line: str) -> Optional[str]:
        match = re.search(r"Final\s+(\d{3,4})", line, re.IGNORECASE)
        if not match:
            return None
        return match.group(1).zfill(4)

    @staticmethod
    def _is_btg_card_section_header(stripped: str) -> bool:
        """Cabeçalho de bloco do cartão (não é lançamento)."""
        if not stripped:
            return False
        if "Lançamentos do cartão" not in stripped and "Lançamentos com" not in stripped:
            return False
        return CartaoConverter._card_last4_from_lancamentos_line(stripped) is not None

    @staticmethod
    def _is_btg_resumo_fatura_header(line: str) -> bool:
        """BTG+ antigo: lançamentos ficam após «resumo da fatura» (antes do bloco Lançamentos)."""
        if not line:
            return False
        return bool(
            re.search(r"resumo da fatura(?! atual\b)", line, re.IGNORECASE)
        )

    @staticmethod
    def _first_lancamentos_card_last4(content: str) -> Optional[str]:
        """Primeiro cartão na ordem dos blocos «Lançamentos … Final XXXX» da fatura."""
        match = re.search(
            r"Lançamentos(?:\s+do\s+cartão|\s+com\b)[^\n]*?\bFinal\s+(\d{3,4})",
            content,
            re.IGNORECASE,
        )
        if not match:
            return None
        return match.group(1).zfill(4)

    @staticmethod
    def _extract_saldo_fatura_anterior_valor(content: str) -> Optional[float]:
        """Resumo da fatura: saldo remanescente da fatura anterior (R$ positivo)."""
        match = re.search(
            r"Saldo fatura anterior e pagamentos\s+R\$\s*([\d.,]+)",
            content,
            re.IGNORECASE,
        )
        if not match:
            return None
        valor = float(match.group(1).replace(".", "").replace(",", "."))
        return valor if valor > 0 else None

    @staticmethod
    def _mes_fatura_para_data_resumo(mes: str) -> str:
        ml = (mes or "").strip().lower()
        abbr_by_num = {
            1: "Jan",
            2: "Fev",
            3: "Mar",
            4: "Abr",
            5: "Mai",
            6: "Jun",
            7: "Jul",
            8: "Ago",
            9: "Set",
            10: "Out",
            11: "Nov",
            12: "Dez",
        }
        if ml.isdigit():
            m_int = int(ml)
            if 1 <= m_int <= 12:
                return f"1 {abbr_by_num[m_int]}"
        abbr_map = {
            "janeiro": "Jan",
            "fevereiro": "Fev",
            "março": "Mar",
            "marco": "Mar",
            "abril": "Abr",
            "maio": "Mai",
            "junho": "Jun",
            "julho": "Jul",
            "agosto": "Ago",
            "setembro": "Set",
            "outubro": "Out",
            "novembro": "Nov",
            "dezembro": "Dez",
        }
        for full, abbr in abbr_map.items():
            if ml == full or ml.startswith(full[:3]):
                return f"1 {abbr}"
        return f"1 {abbr_by_num.get(9, 'Set')}"

    @staticmethod
    def _append_saldo_fatura_anterior_if_needed(
        rows: list,
        content: str,
        target_card: str,
        year: str,
        mes: str,
        mapping,
    ) -> None:
        valor = CartaoConverter._extract_saldo_fatura_anterior_valor(content)
        if valor is None or not target_card or not mes:
            return
        if any(
            "Saldo fatura anterior" in str(item.get("Descrição", ""))
            for item in rows
        ):
            return
        descricao = "Saldo fatura anterior e pagamentos"
        descricao_simples = CartaoConverter.limpar_descricao(descricao)
        data_lancamento = CartaoConverter._mes_fatura_para_data_resumo(mes)
        tag = mapping.get_mapped_tag(None, None, descricao_simples, valor, 2)
        card = target_card.zfill(4)
        rows.append(
            {
                "Ano": year,
                "Mês": mes,
                "Cartão": card,
                "Titular": mapping.get_mapped_credit_card_owner(card),
                "Data": data_lancamento,
                "Descrição": mapping.get_mapped_description(descricao),
                "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                "Valor": valor,
                "Tag": tag,
                "Subtag": mapping.get_mapped_subtag(descricao_simples, tag),
            }
        )

    @staticmethod
    def _is_encargos_juros_section_header(line: str) -> bool:
        stripped = (line or "").strip()
        if stripped != "Encargos e juros":
            return False
        return True

    @staticmethod
    def _consume_encargos_juros_block(
        lines_iter,
        target_card: str,
        year: str,
        mes: str,
        mapping,
        first_line: Optional[str] = None,
    ) -> tuple[list, Optional[str]]:
        """
        Lê linhas após o cabeçalho «Encargos e juros» (multas, mora, IOF rotativo, etc.)
        e aloca no cartão informado (primeiro cartão da fatura).
        Retorna (itens, próxima linha fora do bloco para continuar o parsing).
        """
        rows: list = []
        line = first_line if first_line is not None else next(lines_iter).strip()
        target_card = target_card.zfill(4)

        while line:
            if CartaoConverter._is_btg_card_section_header(line) or (
                "Lançamentos do cartão" in line or "Lançamentos com" in line
            ):
                return rows, line
            if not line or len(line.split()) < 2:
                return rows, line
            if re.match(r"^R\$\s*[\d.,]+\s*$", line):
                try:
                    line = next(lines_iter).strip()
                except StopIteration:
                    return rows, None
                continue

            ultima_parte = line.split()[-1]
            valor_lancamento_str = line.split()[1]
            valor_lancamento = float(
                valor_lancamento_str.replace(".", "").replace(",", ".")
            )
            descricao = line.split(valor_lancamento_str, 1)[-1].strip()

            def _append_encargo_item(
                descricao_raw: str,
                data_raw: str,
                valor: float,
            ) -> None:
                descricao_simples = CartaoConverter.limpar_descricao(descricao_raw)
                tag = mapping.get_mapped_tag(
                    None, None, descricao_simples, valor, 2
                )
                rows.append(
                    {
                        "Ano": year,
                        "Mês": mes,
                        "Cartão": target_card,
                        "Titular": mapping.get_mapped_credit_card_owner(target_card),
                        "Data": data_raw,
                        "Descrição": mapping.get_mapped_description(descricao_raw),
                        "Descrição Limpa": mapping.get_mapped_description(
                            descricao_simples
                        ),
                        "Valor": valor,
                        "Tag": tag,
                        "Subtag": mapping.get_mapped_subtag(descricao_simples, tag),
                    }
                )

            parsed = False
            try:
                float(ultima_parte.replace(".", "").replace(",", "."))
                line = descricao.replace("R$", " @").split("@")[0].strip()
                if len(line.split()) >= 2:
                    data_lancamento = f"{line.split()[-2]} {line.split()[-1]}"
                else:
                    data_lancamento = line
                if data_lancamento:
                    descricao = line.split(data_lancamento, 1)[0].strip()
                else:
                    descricao = line.strip()
                _append_encargo_item(descricao, data_lancamento, valor_lancamento)
                parsed = True
            except (ValueError, TypeError):
                pass

            if not parsed:
                line = descricao
                if "R$" not in line and len(line.split()) >= 2:
                    data_lancamento = f"{line.split()[-2]} {line.split()[-1]}"
                    descricao = (
                        descricao.split(data_lancamento, 1)[0].strip()
                        if data_lancamento
                        else descricao.strip()
                    )
                    _append_encargo_item(
                        descricao, data_lancamento, valor_lancamento
                    )
                else:
                    descricao = descricao.replace("R$", " @").split("@")[0].strip()
                    if len(descricao.split()) >= 2:
                        data_lancamento = (
                            f"{descricao.split()[-2]} {descricao.split()[-1]}"
                        )
                    else:
                        data_lancamento = descricao
                    descricao = (
                        descricao.split(data_lancamento, 1)[0].strip()
                        if data_lancamento
                        else descricao.strip()
                    )
                    _append_encargo_item(
                        descricao, data_lancamento, valor_lancamento
                    )

                    line = line.replace("R$", " @").split("@")[-1].strip()
                    if line and len(line.split()) >= 1:
                        valor_lancamento_str = line.split()[0]
                        valor_lancamento = float(
                            valor_lancamento_str.replace(".", "").replace(",", ".")
                        )
                        descricao = line.split(valor_lancamento_str, 1)[-1].strip()
                        if len(descricao.split()) >= 2:
                            data_lancamento = (
                                f"{descricao.split()[-2]} {descricao.split()[-1]}"
                            )
                        else:
                            data_lancamento = descricao
                        descricao = (
                            descricao.split(data_lancamento, 1)[0].strip()
                            if data_lancamento
                            else descricao.strip()
                        )
                        _append_encargo_item(
                            descricao, data_lancamento, valor_lancamento
                        )

            try:
                line = next(lines_iter).strip()
            except StopIteration:
                return rows, None

        return rows, line

    def _txt_to_excel_line_by_line(self, txt_files: List[str], output_folder: str, save_individually: bool = False,
                                    year_override: str = None, month_override: str = None) -> pd.DataFrame:
        os.makedirs(output_folder, exist_ok=True)

        mes = None
        card_number = None
        valor_lancamento = 0
        data_lancamento = None
        descricao = None
        descricao_aux = None
        descricao_simples = None
        compras_e_despesas = False
        ultimo_lancamento = False
        month_check = False
        dollar = False
        ultima_posicao_dolar = 0

        mapping = self.mapping_helper

        for txt_file in txt_files:
            xlsx_file = os.path.join(output_folder, f"{os.path.splitext(os.path.basename(txt_file))[0]}.xlsx")
            rows = []

            with open(txt_file, "r", encoding="utf-8") as f:
                # Extrai ano do nome do arquivo (formato: YYYY_MM_NomeOriginal.txt)
                filename = os.path.basename(txt_file)
                if year_override:
                    year = year_override
                elif filename.split('_')[0].isdigit() and len(filename.split('_')[0]) == 4:
                    year = filename.split('_')[0]
                else:
                    year = txt_file.split()[-1].replace(".txt", "")

                # Se mes foi fornecido, usa diretamente
                if month_override:
                    mes = month_override

                # Pre-processa todas as linhas para separar transacoes concatenadas
                raw_content = f.read()
                processed_content = CartaoConverter.preprocessar_linha(raw_content)
                first_invoice_card = CartaoConverter._first_lancamentos_card_last4(
                    processed_content
                )
                all_line_list = processed_content.split('\n')
                line_total = len(all_line_list) or 1
                report_row_progress(0, line_total, phase=1)
                all_lines = iter(all_line_list)
                pending_date_line: Optional[str] = None
                pending_valor_first: Optional[Dict[str, Any]] = None
                pending_resume_line: Optional[str] = None
                line_index = 0

                for line in all_lines:
                    line_index += 1
                    report_row_progress(line_index, line_total, phase=1)
                    if pending_resume_line is not None:
                        line = pending_resume_line
                        pending_resume_line = None
                    else:
                        line = line.strip()

                    # Se já temos o mês do override, pula a busca
                    while not mes and not month_override:
                        if line and ("no valor a pagar" in line or "no valor de" in line):
                            # Tenta extrair o mês de diferentes formatos
                            if "|" in line:
                                # Formato antigo: "... | fatura de Dezembro de 2025 | ..."
                                parts = line.split("|")
                                if len(parts) > 1:
                                    mes = parts[1].split()[-1]
                                else:
                                    # Formato: "Dezembro no valor a pagar..."
                                    mes = line.split()[0]
                            else:
                                # Formato novo: "Dezembro no valor a pagar de R$ 20.681,99Luiz..."
                                # Extrai a primeira palavra (que é o mês)
                                mes = line.split()[0]

                            mes = mapping.get_mapped_month_name_by_name(year, mes)
                            continue
                        elif line and "Esta é a fatura do seu cartão EQI de" in line:
                            mes = line.split()[-1]
                            if mes.lower() == "de":
                                line = next(all_lines).strip()
                                mes = line.split()[0]
                            mes = mapping.get_mapped_month_name_by_name(year, mes)
                            continue
                        else:
                            line = next(all_lines).strip()

                    while not card_number:
                        if line and (
                            "Lançamentos do cartão" in line or "Lançamentos com" in line
                        ):
                            if "Final" in line:
                                card_number = (
                                    line.split("Final")[-1]
                                    .split("|")[0]
                                    .split()[0]
                                    .strip()
                                )
                                if card_number:
                                    card_number = card_number.zfill(4)
                            month_check = False
                            continue
                        elif CartaoConverter._is_btg_resumo_fatura_header(line):
                            if first_invoice_card:
                                card_number = first_invoice_card.zfill(4)
                            break
                        elif line and line[:2] == "R$" and len(rows) > 0:
                            compras_e_despesas = True
                            card_number = rows[-1]["Cartão"]
                            month_check = False
                            break
                        elif CartaoConverter._is_encargos_juros_section_header(line):
                            enc_target = first_invoice_card
                            if enc_target:
                                enc_rows, resume = (
                                    CartaoConverter._consume_encargos_juros_block(
                                        all_lines,
                                        enc_target,
                                        year,
                                        mes,
                                        mapping,
                                    )
                                )
                                rows.extend(enc_rows)
                                if resume is None:
                                    break
                                line = resume
                                if CartaoConverter._is_btg_card_section_header(
                                    line
                                ) or (
                                    "Lançamentos do cartão" in line
                                    or "Lançamentos com" in line
                                ):
                                    card_from_line = (
                                        CartaoConverter._card_last4_from_lancamentos_line(
                                            line
                                        )
                                    )
                                    if card_from_line:
                                        card_number = card_from_line
                                    month_check = False
                                    continue
                            else:
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    break
                        else:
                            try:
                                line = next(all_lines).strip()
                            except:
                                break

                    if CartaoConverter._is_encargos_juros_section_header(line):
                        enc_target = first_invoice_card or card_number
                        if enc_target:
                            enc_rows, resume = (
                                CartaoConverter._consume_encargos_juros_block(
                                    all_lines,
                                    enc_target,
                                    year,
                                    mes,
                                    mapping,
                                )
                            )
                            rows.extend(enc_rows)
                            if resume is None:
                                break
                            pending_resume_line = resume
                        continue

                    if (
                        line
                        and card_number
                        and "Total de créditos recebidos" in line
                        and not compras_e_despesas
                    ):
                        line = next(all_lines).strip()
                        while True:
                            if line and line[0] == "-" and len(line.split()) >= 3:
                                valor_lancamento_str = line.split()[2]
                                valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", ".")) * (-1)
                                line = line.removeprefix(f"- R$ {valor_lancamento_str} ").strip()
                                if not line or len(line.split()) < 1:
                                    line = next(all_lines).strip()
                                    continue
                                ultima_parte = line.split()[-1].strip()

                                if year == "2023":
                                    if "-R$" in line:
                                        descricao = line.split("-R$")[0].strip()
                                    else:
                                        descricao = line
                                        descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                        tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)
                                        line = next(all_lines).strip()
                                        continue
                                else:
                                    if "-" in line and "R$" not in line:
                                        descricao = line
                                        descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                        line = next(all_lines).strip()
                                        if not line or len(line.split()) < 1:
                                            continue
                                        ultima_parte = line.split()[-1].strip()
                                        # Somente 1 benefício
                                        try:
                                            valor_aux = float(ultima_parte.replace(".", "").replace(",", "."))
                                            line = line.replace("-"," - ").split("-")[0]
                                            if len(line.split()) >= 2:
                                                data_lancamento = f"{line.split()[0]} {line.split()[1]}"
                                            else:
                                                data_lancamento = line
                                            item = {
                                                "Ano": year,
                                                "Mês": mes,
                                                "Cartão": card_number,
                                                "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                                "Data": data_lancamento,
                                                "Descrição": mapping.get_mapped_description(descricao),
                                                "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                                "Valor": valor_lancamento,
                                                "Tag": tag,
                                                "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                            }

                                            rows.append(item)
                                            line = next(all_lines).strip()
                                            continue

                                        # 2+ benefícios
                                        except:
                                            #avaliar melhor caso aconteça esse cenário
                                            continue

                                break_cancelamento = False
                                if "cancelamento" in line.lower():
                                    while not break_cancelamento:
                                        resultados = CartaoConverter.separar_linhas_duplicadas(line)

                                        def is_last_value(text):
                                            """Verifica se o texto contém apenas valor monetário"""
                                            text_clean = text.strip()
                                            pattern = r'^-\s*R\$\s*[\d.,]+\s*$'
                                            return bool(re.match(pattern, text_clean))

                                        for indice, resultado in enumerate(resultados):
                                            if is_last_value(resultado):
                                                ultima_parte = resultado
                                                break_cancelamento = True
                                                break

                                            match = re.search(r'-\s*R\$\s*([\d.,]+)', resultado)
                                            if match:
                                                valor_lancamento_str = match.group(1)
                                                valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", ".")) * (-1)
                                            else:
                                                valor_lancamento_str = resultado.split()[2]
                                                try:
                                                    valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", ".")) * (-1)
                                                except:
                                                    valor_lancamento_str = "@@"
                                                    pass

                                            parts = resultado.split()
                                            data_lancamento = ' '.join(parts[-2:])
                                            descricao = resultado.split(data_lancamento)[0].strip().split(valor_lancamento_str)[-1].strip()
                                            descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                            tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                                            item = {
                                                "Ano": year,
                                                "Mês": mes,
                                                "Cartão": card_number,
                                                "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                                "Data": data_lancamento,
                                                "Descrição": mapping.get_mapped_description(descricao),
                                                "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                                "Valor": valor_lancamento,
                                                "Tag": tag,
                                                "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                            }

                                            rows.append(item)

                                        line = next(all_lines).strip()

                                else:
                                    descricao = line.split("-")[0].strip()
                                    if len(descricao.split()) >= 2:
                                        data_lancamento = f"{descricao.split()[-2]} {descricao.split()[-1]}"
                                    else:
                                        data_lancamento = descricao
                                    descricao = descricao.removesuffix(data_lancamento).strip()
                                    descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                    tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                                    item = {
                                        "Ano": year,
                                        "Mês": mes,
                                        "Cartão": card_number,
                                        "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                        "Data": data_lancamento,
                                        "Descrição": mapping.get_mapped_description(descricao),
                                        "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                        "Valor": valor_lancamento,
                                        "Tag": tag,
                                        "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                    }

                                    rows.append(item)

                                    # Somente 1 benefício
                                    try:
                                        valor_aux = float(ultima_parte.replace(".", "").replace(",", "."))

                                    # 2+ benefícios
                                    except:
                                        try:
                                            lineaux = line.split(data_lancamento)[-1].strip()
                                            if lineaux and len(lineaux.split()) >= 3:
                                                valor_lancamento_str = lineaux.split()[2]
                                                valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", ".")) * (-1)
                                                descricao = lineaux.split(valor_lancamento_str)[-1].strip()
                                                descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                                tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)
                                        except:
                                            #Cancelamento >> linha: - R$ 240,00 Cancelamento de compra parcelada 22 Jun
                                            pass

                                    line = next(all_lines).strip()
                                    if line and len(line.split()) >= 1:
                                        ultima_parte = line.split()[-1].strip()
                                        try:
                                            valor_aux = float(ultima_parte.replace(".", "").replace(",", "."))
                                            line = line.replace("-R$", " @")
                                        except:
                                            pass

                                if not break_cancelamento:
                                    if line and len(line.split()) >= 2 and line.split()[1].lower() in MONTHS:
                                        while True:
                                            data_lancamento = f"{line.split()[0]} {line.split()[1]}"
                                            item = {
                                                "Ano": year,
                                                "Mês": mes,
                                                "Cartão": card_number,
                                                "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                                "Data": data_lancamento,
                                                "Descrição": mapping.get_mapped_description(descricao),
                                                "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                                "Valor": valor_lancamento,
                                                "Tag": tag,
                                                "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                            }

                                            rows.append(item)

                                            ultima_parte = line.split()[-1].strip()

                                            # Somente 1 benefício
                                            try:
                                                valor_aux = float(ultima_parte.replace(".", "").replace(",", "."))

                                                if year == "2023":
                                                    parts = line.split("-")
                                                    if len(parts) >= 2:
                                                        line = parts[1].strip()
                                                        if len(line.split()) >= 2:
                                                            valor_lancamento_str = line.split()[1]
                                                            valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", ".")) * (-1)
                                                            descricao = line.split(valor_lancamento_str)[-1].strip()
                                                            descricao = descricao.replace(f"-R$ {ultima_parte}", "")
                                                            if len(descricao.split()) >= 2:
                                                                data_lancamento = f"{descricao.split()[-2]} {descricao.split()[-1]}"
                                                            else:
                                                                data_lancamento = descricao
                                                            descricao = descricao.replace(data_lancamento,"").strip()
                                                            descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                                            tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                                                            item = {
                                                                "Ano": year,
                                                                "Mês": mes,
                                                                "Cartão": card_number,
                                                                "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                                                "Data": data_lancamento,
                                                                "Descrição": mapping.get_mapped_description(descricao),
                                                                "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                                                "Valor": valor_lancamento,
                                                                "Tag": tag,
                                                                "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                                            }

                                                            rows.append(item)

                                                line = next(all_lines).strip()
                                                break

                                            # 2+ benefícios
                                            except:
                                                line = line.split("-")[-1].strip()
                                                if line and len(line.split()) >= 2:
                                                    valor_lancamento_str = line.split()[1]
                                                    valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", ".")) * (-1)
                                                    descricao = line.split(valor_lancamento_str)[-1].strip()
                                                    descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                                    tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                                            line = next(all_lines).strip()
                                            continue

                            else:
                                if "Total de compras e despesas" in line:
                                    compras_e_despesas = True
                                    break
                                if "Lançamentos do cartão" in line or "Lançamentos com" in line:
                                    card_from_line = CartaoConverter._card_last4_from_lancamentos_line(line)
                                    if card_from_line:
                                        card_number = card_from_line
                                    compras_e_despesas = False
                                    break
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    break
                                if not line:
                                    break

                    if CartaoConverter._is_btg_resumo_fatura_header(line):
                        if not card_number and first_invoice_card:
                            card_number = first_invoice_card.zfill(4)
                        compras_e_despesas = True
                        continue

                    if line and (
                        "Lançamentos do cartão" in line or "Lançamentos com" in line
                    ):
                        card_from_line = CartaoConverter._card_last4_from_lancamentos_line(line)
                        if card_from_line:
                            card_number = card_from_line
                        compras_e_despesas = True
                        continue

                    if line and compras_e_despesas:
                        compras_loop_guard = 0
                        while compras_e_despesas:
                            compras_loop_guard += 1
                            if compras_loop_guard > 100_000:
                                logger.error(
                                    "Loop de parsing de compras excedeu limite (%s)",
                                    txt_file,
                                )
                                compras_e_despesas = False
                                break

                            stripped = line.strip()

                            if CartaoConverter._is_btg_card_section_header(stripped):
                                card_from_line = (
                                    CartaoConverter._card_last4_from_lancamentos_line(
                                        stripped
                                    )
                                )
                                if card_from_line:
                                    card_number = card_from_line
                                pending_valor_first = None
                                pending_date_line = None
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                continue

                            if CartaoConverter._is_card_subtotal_line(stripped):
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                continue

                            if stripped in (
                                "Total de créditos recebidos",
                                "Créditos recebidos",
                            ) or (
                                stripped.startswith("Total de créditos recebidos")
                                and "R$" not in stripped
                            ):
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                pending_credit = None
                                while line and not (
                                    line.strip() in (
                                        "Total de compras e despesas",
                                        "Total de compras e despesas dessa fatura",
                                    )
                                    or (
                                        line.strip().startswith(
                                            "Total de compras e despesas"
                                        )
                                        and "R$" not in line
                                    )
                                    or CartaoConverter._is_btg_card_section_header(
                                        line.strip()
                                    )
                                ):
                                    ln = line.strip()
                                    if CartaoConverter._is_btg_card_section_header(ln):
                                        break
                                    if CartaoConverter._is_card_subtotal_line(ln):
                                        try:
                                            line = next(all_lines).strip()
                                        except StopIteration:
                                            compras_e_despesas = False
                                            break
                                        continue
                                    if CartaoConverter._is_btg_credit_summary_dupe_line(
                                        ln
                                    ):
                                        dup_date = (
                                            CartaoConverter._btg_date_from_credit_summary_dupe(
                                                ln
                                            )
                                        )
                                        if pending_credit and dup_date:
                                            descricao = pending_credit["descricao"]
                                            descricao_simples = pending_credit[
                                                "descricao_simples"
                                            ]
                                            valor_lancamento = pending_credit["valor"]
                                            tag = mapping.get_mapped_tag(
                                                None,
                                                None,
                                                descricao_simples,
                                                valor_lancamento,
                                                2,
                                            )
                                            rows.append(
                                                {
                                                    "Ano": year,
                                                    "Mês": mes,
                                                    "Cartão": card_number,
                                                    "Titular": mapping.get_mapped_credit_card_owner(
                                                        card_number
                                                    ),
                                                    "Data": dup_date,
                                                    "Descrição": mapping.get_mapped_description(
                                                        descricao
                                                    ),
                                                    "Descrição Limpa": mapping.get_mapped_description(
                                                        descricao_simples
                                                    ),
                                                    "Valor": valor_lancamento,
                                                    "Tag": tag,
                                                    "Subtag": mapping.get_mapped_subtag(
                                                        descricao_simples, tag
                                                    ),
                                                }
                                            )
                                            pending_credit = None
                                        try:
                                            line = next(all_lines).strip()
                                        except StopIteration:
                                            compras_e_despesas = False
                                            break
                                        continue
                                    credit_segments = (
                                        CartaoConverter._split_btg_multi_credito_line(
                                            ln
                                        )
                                    )
                                    parsed_credit = False
                                    for seg in credit_segments:
                                        cred = CartaoConverter._parse_btg_credito_linha(
                                            seg
                                        )
                                        if not cred:
                                            continue
                                        parsed_credit = True
                                        if cred.get("data"):
                                            descricao = cred["descricao"]
                                            descricao_simples = cred[
                                                "descricao_simples"
                                            ]
                                            valor_lancamento = cred["valor"]
                                            tag = mapping.get_mapped_tag(
                                                None,
                                                None,
                                                descricao_simples,
                                                valor_lancamento,
                                                2,
                                            )
                                            rows.append(
                                                {
                                                    "Ano": year,
                                                    "Mês": mes,
                                                    "Cartão": card_number,
                                                    "Titular": mapping.get_mapped_credit_card_owner(
                                                        card_number
                                                    ),
                                                    "Data": cred["data"],
                                                    "Descrição": mapping.get_mapped_description(
                                                        descricao
                                                    ),
                                                    "Descrição Limpa": mapping.get_mapped_description(
                                                        descricao_simples
                                                    ),
                                                    "Valor": valor_lancamento,
                                                    "Tag": tag,
                                                    "Subtag": mapping.get_mapped_subtag(
                                                        descricao_simples, tag
                                                    ),
                                                }
                                            )
                                            pending_credit = None
                                        else:
                                            pending_credit = cred
                                    if parsed_credit:
                                        try:
                                            line = next(all_lines).strip()
                                        except StopIteration:
                                            compras_e_despesas = False
                                            break
                                        continue
                                    if CartaoConverter._is_btg_card_section_header(ln):
                                        break
                                    try:
                                        line = next(all_lines).strip()
                                    except StopIteration:
                                        compras_e_despesas = False
                                        break
                                if pending_credit:
                                    descricao = pending_credit["descricao"]
                                    descricao_simples = pending_credit["descricao_simples"]
                                    data_cred = pending_credit.get("data")
                                    if not data_cred:
                                        descricao, data_cred = (
                                            CartaoConverter._split_btg_credit_embedded_dupe(
                                                descricao
                                            )
                                        )
                                        descricao_simples = CartaoConverter.limpar_descricao(
                                            descricao
                                        )
                                    valor_lancamento = pending_credit["valor"]
                                    tag = mapping.get_mapped_tag(
                                        None,
                                        None,
                                        descricao_simples,
                                        valor_lancamento,
                                        2,
                                    )
                                    rows.append(
                                        {
                                            "Ano": year,
                                            "Mês": mes,
                                            "Cartão": card_number,
                                            "Titular": mapping.get_mapped_credit_card_owner(
                                                card_number
                                            ),
                                            "Data": data_cred or "",
                                            "Descrição": mapping.get_mapped_description(
                                                descricao
                                            ),
                                            "Descrição Limpa": mapping.get_mapped_description(
                                                descricao_simples
                                            ),
                                            "Valor": valor_lancamento,
                                            "Tag": tag,
                                            "Subtag": mapping.get_mapped_subtag(
                                                descricao_simples, tag
                                            ),
                                        }
                                    )
                                    pending_credit = None
                                if line and CartaoConverter._is_btg_card_section_header(
                                    line.strip()
                                ):
                                    continue
                                continue

                            if stripped in (
                                "Total de compras e despesas",
                                "Total de compras e despesas dessa fatura",
                            ) or (
                                stripped.startswith("Total de compras e despesas")
                                and "R$" not in stripped
                            ):
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                continue
                            if CartaoConverter._is_btg_credit_summary_dupe_line(stripped):
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                continue

                            if re.match(r"^\d{1,2}\s+[A-Za-z]{3}$", stripped, re.IGNORECASE):
                                if pending_valor_first:
                                    try:
                                        peek_next = next(all_lines).strip()
                                    except StopIteration:
                                        peek_next = ""
                                    peek_foreign = (
                                        CartaoConverter.parse_linha_lancamento_valor_desc(
                                            peek_next
                                        )
                                        if peek_next
                                        else None
                                    )
                                    if peek_foreign and peek_foreign.get(
                                        "needs_brl_conversion"
                                    ):
                                        if pending_date_line:
                                            data_lancamento = pending_date_line
                                            pending_date_line = None
                                        elif rows:
                                            data_lancamento = rows[-1]["Data"]
                                        else:
                                            data_lancamento = stripped
                                        descricao = pending_valor_first["descricao"]
                                        descricao_simples = pending_valor_first[
                                            "descricao_simples"
                                        ]
                                        valor_lancamento = pending_valor_first["valor"]
                                        tag = mapping.get_mapped_tag(
                                            None,
                                            None,
                                            descricao_simples,
                                            valor_lancamento,
                                            2,
                                        )
                                        rows.append(
                                            {
                                                "Ano": year,
                                                "Mês": mes,
                                                "Cartão": card_number,
                                                "Titular": mapping.get_mapped_credit_card_owner(
                                                    card_number
                                                ),
                                                "Data": data_lancamento,
                                                "Descrição": mapping.get_mapped_description(
                                                    descricao
                                                ),
                                                "Descrição Limpa": mapping.get_mapped_description(
                                                    descricao_simples
                                                ),
                                                "Valor": valor_lancamento,
                                                "Tag": tag,
                                                "Subtag": mapping.get_mapped_subtag(
                                                    descricao_simples, tag
                                                ),
                                            }
                                        )
                                        pending_valor_first = None
                                        pending_date_line = stripped
                                        line = peek_next
                                        continue
                                    descricao = pending_valor_first["descricao"]
                                    descricao_simples = pending_valor_first["descricao_simples"]
                                    valor_lancamento = pending_valor_first["valor"]
                                    data_lancamento = stripped
                                    tag = mapping.get_mapped_tag(
                                        None,
                                        None,
                                        descricao_simples,
                                        valor_lancamento,
                                        2,
                                    )
                                    rows.append(
                                        {
                                            "Ano": year,
                                            "Mês": mes,
                                            "Cartão": card_number,
                                            "Titular": mapping.get_mapped_credit_card_owner(
                                                card_number
                                            ),
                                            "Data": data_lancamento,
                                            "Descrição": mapping.get_mapped_description(
                                                descricao
                                            ),
                                            "Descrição Limpa": mapping.get_mapped_description(
                                                descricao_simples
                                            ),
                                            "Valor": valor_lancamento,
                                            "Tag": tag,
                                            "Subtag": mapping.get_mapped_subtag(
                                                descricao_simples, tag
                                            ),
                                        }
                                    )
                                    pending_valor_first = None
                                    if peek_next:
                                        line = peek_next
                                    else:
                                        try:
                                            line = next(all_lines).strip()
                                        except StopIteration:
                                            compras_e_despesas = False
                                            break
                                    continue
                                pending_date_line = stripped
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    break
                                continue

                            valor_first_line = (
                                CartaoConverter.parse_linha_lancamento_valor_desc(
                                    stripped
                                )
                                or CartaoConverter.parse_linha_lancamento_credito_valor_desc(
                                    stripped
                                )
                            )
                            if (
                                valor_first_line
                                and valor_first_line.get("data") is None
                            ):
                                if (
                                    pending_date_line
                                    and not valor_first_line.get(
                                        "needs_brl_conversion"
                                    )
                                ):
                                    data_lancamento = pending_date_line
                                    pending_date_line = None
                                    descricao = valor_first_line["descricao"]
                                    descricao_simples = valor_first_line[
                                        "descricao_simples"
                                    ]
                                    valor_lancamento = valor_first_line["valor"]
                                    tag = mapping.get_mapped_tag(
                                        None,
                                        None,
                                        descricao_simples,
                                        valor_lancamento,
                                        2,
                                    )
                                    rows.append(
                                        {
                                            "Ano": year,
                                            "Mês": mes,
                                            "Cartão": card_number,
                                            "Titular": mapping.get_mapped_credit_card_owner(
                                                card_number
                                            ),
                                            "Data": data_lancamento,
                                            "Descrição": mapping.get_mapped_description(
                                                descricao
                                            ),
                                            "Descrição Limpa": mapping.get_mapped_description(
                                                descricao_simples
                                            ),
                                            "Valor": valor_lancamento,
                                            "Tag": tag,
                                            "Subtag": mapping.get_mapped_subtag(
                                                descricao_simples, tag
                                            ),
                                        }
                                    )
                                    try:
                                        line = next(all_lines).strip()
                                    except StopIteration:
                                        compras_e_despesas = False
                                        break
                                    continue
                                if valor_first_line.get("needs_brl_conversion"):
                                    data_lancamento = pending_date_line
                                    pending_date_line = None
                                    valor_brl, line = (
                                        CartaoConverter._read_brl_after_usd_purchase(
                                            all_lines
                                        )
                                    )
                                    descricao = valor_first_line["descricao"]
                                    descricao_simples = valor_first_line[
                                        "descricao_simples"
                                    ]
                                    valor_lancamento = (
                                        valor_brl
                                        if valor_brl is not None
                                        else valor_first_line["valor"]
                                    )
                                    tag = mapping.get_mapped_tag(
                                        None,
                                        None,
                                        descricao_simples,
                                        valor_lancamento,
                                        2,
                                    )
                                    rows.append(
                                        {
                                            "Ano": year,
                                            "Mês": mes,
                                            "Cartão": card_number,
                                            "Titular": mapping.get_mapped_credit_card_owner(
                                                card_number
                                            ),
                                            "Data": data_lancamento or "",
                                            "Descrição": mapping.get_mapped_description(
                                                descricao
                                            ),
                                            "Descrição Limpa": mapping.get_mapped_description(
                                                descricao_simples
                                            ),
                                            "Valor": valor_lancamento,
                                            "Tag": tag,
                                            "Subtag": mapping.get_mapped_subtag(
                                                descricao_simples, tag
                                            ),
                                        }
                                    )
                                    if valor_brl is None:
                                        ultima_posicao_dolar = len(rows) - 1
                                    continue
                                pending_valor_first = valor_first_line
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                continue

                            parsed_line = CartaoConverter._parse_linha_lancamento_estruturada(
                                line, pending_date_line
                            )
                            if parsed_line and pending_date_line:
                                pending_date_line = None
                            if parsed_line:
                                pending_valor_first = None
                                descricao = parsed_line['descricao']
                                descricao_simples = parsed_line['descricao_simples']
                                valor_lancamento = parsed_line['valor']
                                data_lancamento = parsed_line['data']
                                if parsed_line.get("needs_brl_conversion"):
                                    pending_date_line = None
                                    valor_brl, line = (
                                        CartaoConverter._read_brl_after_usd_purchase(
                                            all_lines
                                        )
                                    )
                                    if valor_brl is not None:
                                        valor_lancamento = valor_brl
                                    else:
                                        ultima_posicao_dolar = len(rows)
                                else:
                                    if pending_date_line:
                                        pending_date_line = None
                                    try:
                                        line = next(all_lines).strip()
                                    except StopIteration:
                                        break
                                tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)
                                rows.append({
                                    "Ano": year,
                                    "Mês": mes,
                                    "Cartão": card_number,
                                    "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                    "Data": data_lancamento,
                                    "Descrição": mapping.get_mapped_description(descricao),
                                    "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                    "Valor": valor_lancamento,
                                    "Tag": tag,
                                    "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                })
                                dollar = False
                                month_check = False
                                if parsed_line.get("needs_brl_conversion"):
                                    if line and (
                                        "Lançamentos do cartão" in line
                                        or "Lançamentos com" in line
                                    ):
                                        card_from_line = CartaoConverter._card_last4_from_lancamentos_line(line)
                                        if card_from_line:
                                            card_number = card_from_line
                                    elif line and (
                                        "Taxas e" in line or "Taxas e encargos" in line
                                    ):
                                        compras_e_despesas = False
                                        break
                                    continue
                                if "Lançamentos do cartão" in line or "Lançamentos com" in line:
                                    card_from_line = CartaoConverter._card_last4_from_lancamentos_line(line)
                                    if card_from_line:
                                        card_number = card_from_line
                                    month_check = False
                                elif "Taxas e" in line or "Taxas e encargos" in line:
                                    compras_e_despesas = False
                                    month_check = False
                                    break
                                continue

                            if not stripped:
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                continue

                            if CartaoConverter._is_btg_page_break_noise(stripped):
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                continue

                            if (
                                "Taxas e" in stripped
                                or stripped == "BTG+"
                                or stripped.startswith("Total a pagar")
                                or ("encargos" in stripped.lower() and "R$" not in stripped)
                            ):
                                compras_e_despesas = False
                                break

                            if stripped.startswith("Compras") and "R$" not in stripped:
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                continue

                            if "da moeda -" in line or CartaoConverter._is_btg_currency_conversion_noise(
                                stripped
                            ):
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                brl_only = re.fullmatch(
                                    r"R\$\s*([\d.,]+)\s*$", line, re.IGNORECASE
                                )
                                if not brl_only:
                                    try:
                                        line = next(all_lines).strip()
                                    except StopIteration:
                                        compras_e_despesas = False
                                        break
                                    brl_only = re.fullmatch(
                                        r"R\$\s*([\d.,]+)\s*$", line, re.IGNORECASE
                                    )
                                if brl_only and ultima_posicao_dolar > 0:
                                    rows[ultima_posicao_dolar]["Valor"] = float(
                                        brl_only.group(1)
                                        .replace(".", "")
                                        .replace(",", ".")
                                    )
                                    ultima_posicao_dolar = 0
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                continue

                            if CartaoConverter._is_btg_card_section_header(stripped):
                                try:
                                    line = next(all_lines).strip()
                                except StopIteration:
                                    compras_e_despesas = False
                                    break
                                continue

                            if len(line.split()) >= 2 and (line.split()[0] == "R$" or line.split()[0] == "US$"):
                                valor_lancamento_str = line.split()[1]
                                valor_lancamento_str = re.sub(
                                    r"R\$.*$", "", valor_lancamento_str, flags=re.IGNORECASE
                                )
                                valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", "."))
                                descricao = line.split(valor_lancamento_str)[-1].strip()

                                if line.split()[0] == "US$":
                                    dollar = True

                                if descricao and len(descricao.split()) >= 1:
                                    ultima_parte = descricao.split()[-1]
                                    if ultima_parte.lower() in MONTHS and len(line.split()) >= 2:
                                        line = f"{line.split()[-2]} {line.split()[-1]}"
                                        descricao = descricao.split(line)[0].strip()

                                descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                            elif "R$" in line or "US$" in line:
                                month_check = True

                            if dollar:
                                line = next(all_lines).strip()

                                if line and len(line.split()) >= 1:
                                    ultima_parte = line.split()[-1]
                                    try:
                                        valor_aux = float(ultima_parte.replace(".", "").replace(",", "."))
                                        if len(line.split()) >= 2:
                                            data_lancamento = f"{line.split()[0]} {line.split()[1].removesuffix('R$')}"
                                        else:
                                            data_lancamento = line
                                    except:
                                        data_lancamento = line
                                else:
                                    data_lancamento = line

                                line = next(all_lines).strip()

                                if line and "BTG Pactual" in line:
                                    line = next(all_lines).strip()
                                    line = next(all_lines).strip()
                                    line = next(all_lines).strip()
                                    line = next(all_lines).strip()
                                    line = next(all_lines).strip()
                                    line = next(all_lines).strip()
                                    line = next(all_lines).strip()
                                else:
                                    line = next(all_lines).strip()
                                    line = next(all_lines).strip()
                                    if line and len(line.split()) >= 2:
                                        valor_lancamento_str = line.split()[1]

                                if "R$" in valor_lancamento_str:
                                    valor_lancamento_str_aux = valor_lancamento_str.removesuffix("R$")
                                    valor_lancamento = float(valor_lancamento_str_aux.replace(".", "").replace(",", "."))
                                    item = {
                                        "Ano": year,
                                        "Mês": mes,
                                        "Cartão": card_number,
                                        "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                        "Data": data_lancamento,
                                        "Descrição": mapping.get_mapped_description(descricao),
                                        "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                        "Valor": valor_lancamento,
                                        "Tag": tag,
                                        "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                    }

                                    rows.append(item)
                                    ultima_posicao_dolar = len(rows) - 1

                                    if line and len(line.split()) >= 1:
                                        ultima_parte = line.split()[-1]
                                        try:
                                            valor_aux = float(ultima_parte.replace(".", "").replace(",", "."))
                                            dollar = False
                                            month_check = False
                                            if not CartaoConverter._is_btg_page_break_noise(
                                                line
                                            ):
                                                compras_e_despesas = False
                                        except:
                                            parts = line.split(valor_lancamento_str)
                                            if len(parts) >= 2:
                                                line = parts[1].strip()
                                                if line and len(line.split()) >= 1:
                                                    valor_lancamento_str_aux = line.split()[0]
                                                    valor_lancamento = float(valor_lancamento_str_aux.replace(".", "").replace(",", "."))
                                                    descricao = line.split(valor_lancamento_str_aux)[-1].strip()
                                                    descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                                    tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                                else:
                                    valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", ".")) if line != "" else 0
                                    item = {
                                        "Ano": year,
                                        "Mês": mes,
                                        "Cartão": card_number,
                                        "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                        "Data": data_lancamento,
                                        "Descrição": mapping.get_mapped_description(descricao),
                                        "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                        "Valor": valor_lancamento,
                                        "Tag": tag,
                                        "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                    }

                                    rows.append(item)
                                    ultima_posicao_dolar = len(rows) - 1

                                dollar = False
                                month_check = False

                            if len(line.split()) >= 2 and line.split()[1].lower() in MONTHS:
                                inline_moeda = (
                                    CartaoConverter.parse_linha_lancamento_data_moeda_desc(
                                        line
                                    )
                                )
                                if inline_moeda:
                                    descricao = inline_moeda["descricao"]
                                    descricao_simples = inline_moeda["descricao_simples"]
                                    valor_lancamento = inline_moeda["valor"]
                                    data_lancamento = inline_moeda["data"]
                                    tag = mapping.get_mapped_tag(
                                        None,
                                        None,
                                        descricao_simples,
                                        valor_lancamento,
                                        2,
                                    )
                                    rows.append(
                                        {
                                            "Ano": year,
                                            "Mês": mes,
                                            "Cartão": card_number,
                                            "Titular": mapping.get_mapped_credit_card_owner(
                                                card_number
                                            ),
                                            "Data": data_lancamento,
                                            "Descrição": mapping.get_mapped_description(
                                                descricao
                                            ),
                                            "Descrição Limpa": mapping.get_mapped_description(
                                                descricao_simples
                                            ),
                                            "Valor": valor_lancamento,
                                            "Tag": tag,
                                            "Subtag": mapping.get_mapped_subtag(
                                                descricao_simples, tag
                                            ),
                                        }
                                    )
                                    pending_valor_first = None
                                    try:
                                        line = next(all_lines).strip()
                                    except StopIteration:
                                        compras_e_despesas = False
                                        break
                                    continue

                                late_parsed = (
                                    CartaoConverter._parse_linha_lancamento_estruturada(
                                        line, pending_date_line
                                    )
                                    if ("R$" in line or "US$" in line)
                                    else None
                                )
                                if late_parsed:
                                    descricao = late_parsed["descricao"]
                                    descricao_simples = late_parsed["descricao_simples"]
                                    valor_lancamento = late_parsed["valor"]
                                    data_lancamento = late_parsed["data"]
                                    tag = mapping.get_mapped_tag(
                                        None,
                                        None,
                                        descricao_simples,
                                        valor_lancamento,
                                        2,
                                    )
                                    rows.append(
                                        {
                                            "Ano": year,
                                            "Mês": mes,
                                            "Cartão": card_number,
                                            "Titular": mapping.get_mapped_credit_card_owner(
                                                card_number
                                            ),
                                            "Data": data_lancamento,
                                            "Descrição": mapping.get_mapped_description(
                                                descricao
                                            ),
                                            "Descrição Limpa": mapping.get_mapped_description(
                                                descricao_simples
                                            ),
                                            "Valor": valor_lancamento,
                                            "Tag": tag,
                                            "Subtag": mapping.get_mapped_subtag(
                                                descricao_simples, tag
                                            ),
                                        }
                                    )
                                    pending_date_line = None
                                    dollar = False
                                    month_check = False
                                    try:
                                        line = next(all_lines).strip()
                                    except StopIteration:
                                        compras_e_despesas = False
                                        break
                                    continue

                                mes_abreviado = line.split()[1]
                                if "R$" in line and not "R$" in mes_abreviado:
                                    line = line.replace(" R$","R$")
                                    if len(line.split()) >= 2:
                                        mes_abreviado = line.split()[1]

                                if line and len(line.split()) >= 1 and ("R$" in mes_abreviado or "US$" in mes_abreviado):
                                    sufixo = None
                                    if "R$" in mes_abreviado:
                                        sufixo = "R$"
                                    else:
                                        sufixo = "US$"

                                    ultima_parte = line.split(mes_abreviado)[-1]
                                    mes_abreviado_aux = mes_abreviado.removesuffix(sufixo)

                                    try:
                                        valor_aux = float(ultima_parte.replace(".", "").replace(",", "."))
                                        if len(line.split()) >= 1:
                                            data_lancamento = f"{line.split()[0]} {mes_abreviado_aux}"
                                        else:
                                            data_lancamento = mes_abreviado_aux

                                        item = {
                                            "Ano": year,
                                            "Mês": mes,
                                            "Cartão": card_number,
                                            "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                            "Data": data_lancamento,
                                            "Descrição": mapping.get_mapped_description(descricao),
                                            "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                            "Valor": valor_lancamento,
                                            "Tag": tag,
                                            "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                        }

                                        rows.append(item)

                                        try:
                                            line = next(all_lines).strip()
                                        except StopIteration:
                                            compras_e_despesas = False
                                            break
                                        continue

                                    except:
                                        line = line.replace(mes_abreviado, f"{mes_abreviado_aux} @")
                                        if len(line.split()) >= 1:
                                            data_lancamento = f"{line.split()[0]} {mes_abreviado_aux}"
                                        else:
                                            data_lancamento = mes_abreviado_aux

                                        item = {
                                            "Ano": year,
                                            "Mês": mes,
                                            "Cartão": card_number,
                                            "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                            "Data": data_lancamento,
                                            "Descrição": mapping.get_mapped_description(descricao),
                                            "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                            "Valor": valor_lancamento,
                                            "Tag": tag,
                                            "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                        }

                                        rows.append(item)

                                        line = line.split("@")[-1].strip()
                                        if line and len(line.split()) >= 1:
                                            valor_lancamento_str = line.split()[0]
                                            valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", "."))
                                            descricao = line.split(valor_lancamento_str)[-1].strip()
                                            descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                            tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                                        if sufixo == "US$":
                                            dollar = True
                                            continue

                                else:
                                    if len(line.split()) >= 2:
                                        data_lancamento = f"{line.split()[0]} {line.split()[1]}"
                                    else:
                                        data_lancamento = line
                                    # Só cria lançamento se já temos descrição e valor definidos
                                    # (formato em que valor vem antes da data em linhas separadas)
                                    if (
                                        descricao
                                        and valor_lancamento
                                        and ("R$" in line or "US$" in line)
                                        and not CartaoConverter._is_btg_card_section_header(
                                            stripped
                                        )
                                        and not CartaoConverter._is_btg_page_break_noise(
                                            stripped
                                        )
                                    ):
                                        item = {
                                            "Ano": year,
                                            "Mês": mes,
                                            "Cartão": card_number,
                                            "Titular": mapping.get_mapped_credit_card_owner(card_number),
                                            "Data": data_lancamento,
                                            "Descrição": mapping.get_mapped_description(descricao),
                                            "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                            "Valor": valor_lancamento,
                                            "Tag": tag,
                                            "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                        }
                                        rows.append(item)

                                month_check = False
                            try:
                                line = next(all_lines).strip()
                                if (
                                    "Lançamentos do cartão" in line
                                    or "Lançamentos com" in line
                                ):
                                    card_from_line = (
                                        CartaoConverter._card_last4_from_lancamentos_line(
                                            line
                                        )
                                    )
                                    if card_from_line:
                                        card_number = card_from_line
                                    compras_e_despesas = True
                                    month_check = False
                                elif "Taxas e encargos" in line:
                                    compras_e_despesas = False
                                    month_check = False
                                    break
                            except:
                                break

                        if "Lançamentos do cartão" in line or "Lançamentos com" in line:
                            if "Final" in line:
                                card_number = (
                                    line.split("Final")[-1]
                                    .split("|")[0]
                                    .split()[0]
                                    .strip()
                                )

                CartaoConverter._append_saldo_fatura_anterior_if_needed(
                    rows,
                    processed_content,
                    first_invoice_card or "",
                    year,
                    month_override or mes or "",
                    mapping,
                )

            mes = None
            card_number = None
            valor_lancamento = 0
            data_lancamento = None
            descricao = None
            descricao_simples = None
            compras_e_despesas = False
            ultimo_lancamento = False
            dollar = False
            ultima_posicao_dolar = 0
            month_check = False

            # Save to Excel
            df = pd.DataFrame(rows)
            if save_individually:
                df.to_excel(xlsx_file, index=False)
                print(f"Converted {txt_file} to {xlsx_file}")
                rows = []

            return df

