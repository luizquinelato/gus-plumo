# -*- coding: utf-8 -*-
"""
CryptoHelper - Utilitário para criptografia de dados sensíveis
Usa AES-256-GCM via Fernet (biblioteca cryptography)
"""
import os
from typing import Optional, Union
from decimal import Decimal
from cryptography.fernet import Fernet
import base64


class CryptoHelper:
    """Helper para criptografia e descriptografia de dados sensíveis."""
    
    def __init__(self, encryption_key: Optional[str] = None):
        """
        Inicializa o helper de criptografia.
        
        Args:
            encryption_key: Chave de criptografia (base64). Se None, lê do .env
        """
        if encryption_key is None:
            encryption_key = os.getenv('ENCRYPTION_KEY')
        
        if not encryption_key:
            raise ValueError("ENCRYPTION_KEY não encontrada no .env")
        
        # Valida que a chave está em formato base64 válido
        try:
            self.fernet = Fernet(encryption_key.encode())
        except Exception as e:
            raise ValueError(f"ENCRYPTION_KEY inválida: {e}")
    
    def encrypt(self, value: Union[str, int, float, Decimal]) -> str:
        """
        Criptografa um valor.
        
        Args:
            value: Valor a ser criptografado (str, int, float, Decimal)
            
        Returns:
            str: Valor criptografado em base64
            
        Example:
            >>> crypto = CryptoHelper()
            >>> encrypted = crypto.encrypt("badoo")
            >>> print(encrypted)
            'gAAAAABl...'
        """
        if value is None:
            return None
        
        # Converte para string
        if isinstance(value, Decimal):
            value_str = str(value)
        elif isinstance(value, (int, float)):
            value_str = str(value)
        else:
            value_str = str(value)
        
        # Criptografa
        encrypted_bytes = self.fernet.encrypt(value_str.encode('utf-8'))
        
        # Retorna como string base64
        return encrypted_bytes.decode('utf-8')
    
    def decrypt(self, encrypted_value: str) -> str:
        """
        Descriptografa um valor.
        
        Args:
            encrypted_value: Valor criptografado (base64)
            
        Returns:
            str: Valor descriptografado
            
        Example:
            >>> crypto = CryptoHelper()
            >>> decrypted = crypto.decrypt('gAAAAABl...')
            >>> print(decrypted)
            'badoo'
        """
        if not encrypted_value:
            return None
        
        try:
            # Descriptografa
            decrypted_bytes = self.fernet.decrypt(encrypted_value.encode('utf-8'))
            
            # Retorna como string
            return decrypted_bytes.decode('utf-8')
        except Exception as e:
            print(f"⚠️  Erro ao descriptografar: {e}")
            return None
    
    def decrypt_to_decimal(self, encrypted_value: str) -> Optional[Decimal]:
        """
        Descriptografa um valor e converte para Decimal.
        
        Args:
            encrypted_value: Valor criptografado (base64)
            
        Returns:
            Decimal: Valor descriptografado como Decimal ou None
        """
        decrypted = self.decrypt(encrypted_value)
        if decrypted is None:
            return None
        
        try:
            return Decimal(decrypted)
        except Exception as e:
            print(f"⚠️  Erro ao converter para Decimal: {e}")
            return None
    
    def decrypt_to_float(self, encrypted_value: str) -> Optional[float]:
        """
        Descriptografa um valor e converte para float.
        
        Args:
            encrypted_value: Valor criptografado (base64)
            
        Returns:
            float: Valor descriptografado como float ou None
        """
        decrypted = self.decrypt(encrypted_value)
        if decrypted is None:
            return None
        
        try:
            return float(decrypted)
        except Exception as e:
            print(f"⚠️  Erro ao converter para float: {e}")
            return None


# Instância global (singleton)
_crypto_instance = None

def get_crypto_helper() -> CryptoHelper:
    """
    Retorna instância singleton do CryptoHelper.
    
    Returns:
        CryptoHelper: Instância do helper de criptografia
    """
    global _crypto_instance
    if _crypto_instance is None:
        _crypto_instance = CryptoHelper()
    return _crypto_instance

