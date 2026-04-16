"""
RBAC - Role-Based Access Control
Sistema de controle de acesso baseado em permissões
"""

from typing import Dict, List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from .config import get_settings

settings = get_settings()


class RBAC:
    """Gerenciador de permissões RBAC."""
    
    @staticmethod
    def get_database_connection():
        """Obtém conexão com o banco de dados."""
        return psycopg2.connect(
            host=settings.DB_HOST,
            port=settings.DB_PORT,
            database=settings.DB_NAME,
            user=settings.DB_USER,
            password=settings.DB_PASSWORD,
            cursor_factory=RealDictCursor
        )
    
    @staticmethod
    def verificar_permissao(user_id: int, tenant_id: int, recurso: str, acao: str) -> bool:
        """
        Verifica se o usuário tem permissão para executar uma ação em um recurso.
        
        Args:
            user_id: ID do usuário
            tenant_id: ID do tenant
            recurso: Nome do recurso (ex: 'tags', 'faturas_cartoes')
            acao: Ação a ser executada (ex: 'create', 'read', 'update', 'delete')
            
        Returns:
            True se o usuário tem permissão, False caso contrário
        """
        conn = RBAC.get_database_connection()
        try:
            cursor = conn.cursor()
            
            # Verifica se o usuário é admin
            cursor.execute("""
                SELECT is_admin FROM users
                WHERE id = %s AND tenant_id = %s AND active = TRUE;
            """, (user_id, tenant_id))
            
            user = cursor.fetchone()
            if user and user['is_admin']:
                return True
            
            # Verifica permissão específica
            cursor.execute("""
                SELECT granted FROM users_permissions
                WHERE user_id = %s 
                  AND tenant_id = %s 
                  AND resource = %s 
                  AND action = %s 
                  AND active = TRUE;
            """, (user_id, tenant_id, recurso, acao))
            
            permission = cursor.fetchone()
            return permission and permission['granted']
            
        finally:
            conn.close()
    
    @staticmethod
    def obter_permissoes_usuario(user_id: int, tenant_id: int) -> Dict[str, List[str]]:
        """
        Obtém todas as permissões de um usuário.
        
        Args:
            user_id: ID do usuário
            tenant_id: ID do tenant
            
        Returns:
            Dicionário com recursos e ações permitidas
        """
        conn = RBAC.get_database_connection()
        try:
            cursor = conn.cursor()
            
            # Verifica se é admin
            cursor.execute("""
                SELECT is_admin FROM users
                WHERE id = %s AND tenant_id = %s AND active = TRUE;
            """, (user_id, tenant_id))
            
            user = cursor.fetchone()
            if user and user['is_admin']:
                # Admin tem acesso total
                return {'*': ['*']}
            
            # Busca permissões específicas
            cursor.execute("""
                SELECT resource, action FROM users_permissions
                WHERE user_id = %s 
                  AND tenant_id = %s 
                  AND granted = TRUE 
                  AND active = TRUE;
            """, (user_id, tenant_id))
            
            permissions = cursor.fetchall()
            
            # Organiza permissões por recurso
            result = {}
            for perm in permissions:
                recurso = perm['resource']
                acao = perm['action']
                
                if recurso not in result:
                    result[recurso] = []
                result[recurso].append(acao)
            
            return result
            
        finally:
            conn.close()

