# -*- coding: utf-8 -*-
"""
CardHelper - Utilitário para operações com cartões de crédito
"""
from typing import Optional
from sqlalchemy.orm import Session
from app.models.unified_models import Cartao


class CardHelper:
    """Helper para operações com cartões de crédito."""

    @staticmethod
    def normalize_card_number(number: str) -> str:
        """
        Normaliza número de cartão removendo zeros à esquerda.
        
        Exemplos:
            "0323" -> "323"
            "323" -> "323"
            "0001" -> "1"
            "1234" -> "1234"
        
        Args:
            number: Número do cartão (últimos 4 dígitos)
            
        Returns:
            str: Número normalizado sem zeros à esquerda
        """
        if not number:
            return number
        return str(int(number)) if number.isdigit() else number
    
    @staticmethod
    def find_card_by_number(db: Session, number: str, tenant_id: int = 1) -> Optional[Cartao]:
        """
        Busca cartão pelo número, comparando números normalizados.
        
        Compara números sem zeros à esquerda para garantir que "323" 
        encontre "0323" no banco.
        
        Args:
            db: Sessão do banco de dados
            number: Número do cartão (últimos 4 dígitos)
            tenant_id: ID do tenant
            
        Returns:
            Cartao: Objeto Cartao ou None se não encontrado
        """
        # Busca todos os cartões do tenant
        cartoes = db.query(Cartao).filter(Cartao.tenant_id == tenant_id).all()
        
        normalized_input = CardHelper.normalize_card_number(number)
        
        # Compara números normalizados
        for cartao in cartoes:
            if CardHelper.normalize_card_number(cartao.number) == normalized_input:
                return cartao
        
        return None
    
    @staticmethod
    def get_card_id_by_number(db: Session, number: str, tenant_id: int = 1) -> Optional[int]:
        """
        Retorna o ID do cartão pelo número, comparando números normalizados.
        
        Compara números sem zeros à esquerda para garantir que "323" 
        encontre "0323" no banco.
        
        Args:
            db: Sessão do banco de dados
            number: Número do cartão (últimos 4 dígitos)
            tenant_id: ID do tenant
            
        Returns:
            int: ID do cartão ou None se não encontrado
        """
        cartao = CardHelper.find_card_by_number(db, number, tenant_id)
        return cartao.id if cartao else None
    
    @staticmethod
    def get_card_number_by_id(db: Session, card_id: int) -> Optional[str]:
        """
        Retorna o número do cartão pelo ID.
        
        Args:
            db: Sessão do banco de dados
            card_id: ID do cartão
            
        Returns:
            str: Número do cartão ou None se não encontrado
        """
        cartao = db.query(Cartao).filter(Cartao.id == card_id).first()
        return cartao.number if cartao else None

