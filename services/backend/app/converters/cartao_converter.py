# -*- coding: utf-8 -*-
import os
import re
from typing import List, Optional
import pandas as pd
from PyPDF2 import PdfReader
from ..utils.mapping_helper import MappingHelper

MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]

class CartaoConverter:
    def __init__(self, mapping_helper: Optional[MappingHelper] = None):
        self.mapping_helper = mapping_helper or MappingHelper()
    
    def process_pdf_files(self, file_paths: List[str], output_folder: str,
                          save_individually: bool = False, save_temp_files: bool = False,
                          years: List[str] = None, months: List[str] = None) -> pd.DataFrame:
        txt_folder = os.path.join(output_folder, "txt")
        txt_files = self._pdf_to_txt(file_paths, txt_folder)
        all_data = []

        for i, txt_file in enumerate(txt_files):
            # Passa ano e mês específicos se fornecidos
            year_override = years[i] if years and i < len(years) else None
            month_override = months[i] if months and i < len(months) else None
            df = self._txt_to_excel_line_by_line([txt_file], output_folder, save_individually,
                                                  year_override=year_override, month_override=month_override)
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
            return combined_df
        return pd.DataFrame()
    
    @staticmethod
    def _pdf_to_txt(file_paths: List[str], txt_folder: str) -> List[str]:
        os.makedirs(txt_folder, exist_ok=True)
        txt_files = []

        for pdf_path in file_paths:
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

            with open(txt_path, "w", encoding="utf-8") as txt:
                reader = PdfReader(pdf_path)
                for page in reader.pages:
                    txt.write(page.extract_text() or "")
            print(f"Converted {pdf_path} to {txt_path}")

        return txt_files
    
    @staticmethod
    def limpar_descricao(descricao: str) -> str:
        return re.sub(r'\s*\(.*?\)', '', descricao)
    
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

        Args:
            content: Conteudo de texto do PDF

        Returns:
            Conteudo pre-processado com quebras de linha onde necessario
        """
        # Padrao: DD Mmm colado com R$ ou US$ (sem espaco)
        # Ex: "19 JanR$ 176,45" -> "19 Jan\nR$ 176,45"
        # Ex: "24 JanR$ 456,32" -> "24 Jan\nR$ 456,32"
        pattern = r'(\d{1,2}\s+[A-Za-z]{3})(R\$|US\$)'
        content = re.sub(pattern, r'\1\n\2', content)

        return content

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
                all_lines = iter(processed_content.split('\n'))

                for line in all_lines:
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
                        if line and "Lançamentos do cartão" in line:
                            card_number = line.split("Final")[-1].split()[0]
                            month_check = False
                            continue
                        elif line and line[:2] == "R$" and len(rows) > 0:
                            compras_e_despesas = True
                            card_number = rows[-1]["Cartão"]
                            month_check = False
                            break
                        elif line and "Encargos e juros" in line:
                            line = next(all_lines).strip()
                            while True:
                                if not line or len(line.split()) < 2:
                                    break
                                ultima_parte = line.split()[-1]
                                valor_lancamento_str = line.split()[1]
                                valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", "."))
                                descricao = line.split(valor_lancamento_str)[-1].strip()

                                try:
                                    valor_aux = float(ultima_parte.replace(".", "").replace(",", "."))
                                    line = descricao.replace("R$"," @").split("@")[0].strip()
                                    if len(line.split()) >= 2:
                                        data_lancamento = f"{line.split()[-2]} {line.split()[-1]}"
                                    else:
                                        data_lancamento = line
                                    descricao = line.split(data_lancamento)[0].strip()
                                    descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                    tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                                    item = {
                                        "Ano": year,
                                        "Mês": mes,
                                        "Cartão": "3529",
                                        "Titular": mapping.get_mapped_credit_card_owner("3529"),
                                        "Data": data_lancamento,
                                        "Descrição": mapping.get_mapped_description(descricao),
                                        "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                        "Valor": valor_lancamento,
                                        "Tag": tag,
                                        "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                    }

                                    rows.append(item)
                                    break
                                except:
                                    pass

                                line = descricao
                                if not "R$" in line and len(line.split()) >= 2:
                                    data_lancamento = f"{line.split()[-2]} {line.split()[-1]}"
                                    descricao = descricao.split(data_lancamento)[0].strip()
                                    descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                    tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                                    item = {
                                        "Ano": year,
                                        "Mês": mes,
                                        "Cartão": "3529",
                                        "Titular": mapping.get_mapped_credit_card_owner("3529"),
                                        "Data": data_lancamento,
                                        "Descrição": mapping.get_mapped_description(descricao),
                                        "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                        "Valor": valor_lancamento,
                                        "Tag": tag,
                                        "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                    }

                                    rows.append(item)
                                else:
                                    descricao = descricao.replace("R$"," @").split("@")[0].strip()
                                    if len(descricao.split()) >= 2:
                                        data_lancamento = f"{descricao.split()[-2]} {descricao.split()[-1]}"
                                    else:
                                        data_lancamento = descricao
                                    descricao = descricao.split(data_lancamento)[0].strip()
                                    descricao_simples = CartaoConverter.limpar_descricao(descricao)
                                    tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                                    item = {
                                        "Ano": year,
                                        "Mês": mes,
                                        "Cartão": "3529",
                                        "Titular": mapping.get_mapped_credit_card_owner("3529"),
                                        "Data": data_lancamento,
                                        "Descrição": mapping.get_mapped_description(descricao),
                                        "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
                                        "Valor": valor_lancamento,
                                        "Tag": tag,
                                        "Subtag": mapping.get_mapped_subtag(descricao_simples, tag)
                                    }

                                    rows.append(item)

                                    line = line.replace("R$"," @").split("@")[-1].strip()
                                    if line and len(line.split()) >= 1:
                                        valor_lancamento_str = line.split()[0]
                                        valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", "."))
                                        descricao = line.split(valor_lancamento_str)[-1].strip()
                                        if len(descricao.split()) >= 2:
                                            data_lancamento = f"{descricao.split()[-2]} {descricao.split()[-1]}"
                                        else:
                                            data_lancamento = descricao
                                        descricao = descricao.split(data_lancamento)[0].strip()
                                        tag = mapping.get_mapped_tag(None, None, descricao_simples, valor_lancamento, 2)

                                    item = {
                                        "Ano": year,
                                        "Mês": mes,
                                        "Cartão": "3529",
                                        "Titular": mapping.get_mapped_credit_card_owner("3529"),
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
                            try:
                                line = next(all_lines).strip()
                            except:
                                break

                    if line and card_number and "Total de créditos recebidos" in line:
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
                                            import re
                                            text_clean = text.strip()
                                            pattern = r'^-\s*R\$\s*[\d.,]+\s*$'
                                            return bool(re.match(pattern, text_clean))

                                        for indice, resultado in enumerate(resultados):
                                            if is_last_value(resultado):
                                                ultima_parte = resultado
                                                break_cancelamento = True
                                                break

                                            import re
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

                            if "Total de compras e despesas" in line:
                                compras_e_despesas = True
                                break

                            if  "Lançamentos do cartão" in line:
                                card_number = line.split("Final")[-1].split()[0]
                                compras_e_despesas = False
                                break

                    if line and "Total de compras e despesas" in line:
                        compras_e_despesas = True
                        continue

                    if line and compras_e_despesas:
                        while compras_e_despesas:
                            if "da moeda -" in line:
                                if len(line.split()) >= 2:
                                    data_lancamento = f"{line.split()[0]} {line.split()[1].removesuffix('Cotação')}"
                                else:
                                    data_lancamento = line.split()[0] if len(line.split()) >= 1 else ""
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
                                line = next(all_lines).strip()
                                if line and len(line.split()) >= 2:
                                    valor_lancamento_str = line.split()[1]
                                    valor_lancamento = float(valor_lancamento_str.replace(".", "").replace(",", "."))
                                    rows[ultima_posicao_dolar]["Valor"] = valor_lancamento
                                ultima_posicao_dolar = 0
                                line = next(all_lines).strip()

                            if len(line.split()) >= 2 and (line.split()[0] == "R$" or line.split()[0] == "US$"):
                                valor_lancamento_str = line.split()[1]
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

                            if len(line.split()) >= 2 and (line.split()[1].lower() in MONTHS or month_check):
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

                                        compras_e_despesas = False
                                        card_number = None
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
                                if  "Lançamentos do cartão" in line:
                                    compras_e_despesas = False
                                    month_check = False
                                elif "Taxas e encargos" in line:
                                    compras_e_despesas = False
                                    month_check = False
                                    break
                            except:
                                break

                        if  "Lançamentos do cartão" in line:
                            card_number = line.split("Final")[-1].split()[0]
                        else:
                            card_number = None

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

