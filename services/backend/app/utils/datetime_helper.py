# -*- coding: utf-8 -*-
"""
DatetimeHelper - Utilitário para conversão de datas
Copiado do gus-converter/helper.py
"""
from datetime import datetime


class DatetimeHelper:
    """Helper para conversão de datas em diferentes formatos."""
    
    @staticmethod
    def convert_to_datetime(datetime_str):
        """
        Converte string de data para objeto datetime.
        Tenta múltiplos formatos até encontrar o correto.
        
        Args:
            datetime_str: String contendo data/hora
            
        Returns:
            datetime: Objeto datetime convertido
        """
        original_format = "%d/%m/%Y %H:%M"
        dt = None

        try:
            dt = datetime.strptime(datetime_str, original_format) 
        except Exception as e1:
            try:
                original_format = "%d/%m/%Y %H:%M:%S"
                dt = datetime.strptime(datetime_str, original_format) 
            except Exception as e2:
                if datetime_str: 
                    datetime_str = datetime_str.strip("'")
                    dt = datetime.fromisoformat(datetime_str)
        
        return dt
    
    @staticmethod
    def convert_datetime_to_str(datetime_value):
        """
        Converte objeto datetime para string no formato brasileiro.
        
        Args:
            datetime_value: Objeto datetime
            
        Returns:
            str: Data formatada como "DD/MM/YYYY HH:MM"
        """
        format = "%d/%m/%Y %H:%M"
        dt_str = datetime.strftime(datetime_value, format)
        
        return dt_str

