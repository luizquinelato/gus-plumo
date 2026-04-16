"""
Provider Local de Autenticação
Autentica usuários usando email e senha armazenados no banco de dados
"""

import hashlib
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Optional, Dict, Any
from datetime import datetime
from ..core.config import get_settings

settings = get_settings()


class LocalProvider:
    """Provider de autenticação local."""
    
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
    def hash_password(password: str) -> str:
        """Gera hash SHA256 da senha."""
        return hashlib.sha256(password.encode()).hexdigest()
    
    @staticmethod
    def validar_credenciais(email: str, password: str) -> Optional[Dict[str, Any]]:
        """
        Valida credenciais de usuário.
        
        Args:
            email: Email do usuário
            password: Senha do usuário
            
        Returns:
            Dados do usuário se válido, None caso contrário
        """
        conn = LocalProvider.get_database_connection()
        try:
            cursor = conn.cursor()
            
            # Busca usuário por email
            cursor.execute("""
                SELECT 
                    u.id,
                    u.tenant_id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.role,
                    u.is_admin,
                    u.theme_mode,
                    u.password_hash,
                    t.name as tenant_name
                FROM users u
                JOIN tenants t ON u.tenant_id = t.id
                WHERE u.email = %s 
                  AND u.active = TRUE
                  AND t.active = TRUE;
            """, (email,))
            
            user = cursor.fetchone()
            
            if not user:
                return None
            
            # Verifica senha
            password_hash = LocalProvider.hash_password(password)
            if user['password_hash'] != password_hash:
                return None
            
            # Atualiza último login
            cursor.execute("""
                UPDATE users 
                SET last_login_at = %s 
                WHERE id = %s;
            """, (datetime.now(), user['id']))
            conn.commit()
            
            # Remove hash da senha do retorno
            user_data = dict(user)
            del user_data['password_hash']
            
            return user_data
            
        finally:
            conn.close()
    
    @staticmethod
    def obter_usuario_por_id(user_id: int, tenant_id: int) -> Optional[Dict[str, Any]]:
        """
        Obtém dados do usuário por ID.
        
        Args:
            user_id: ID do usuário
            tenant_id: ID do tenant
            
        Returns:
            Dados do usuário se encontrado, None caso contrário
        """
        conn = LocalProvider.get_database_connection()
        try:
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT 
                    u.id,
                    u.tenant_id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.role,
                    u.is_admin,
                    u.theme_mode,
                    t.name as tenant_name
                FROM users u
                JOIN tenants t ON u.tenant_id = t.id
                WHERE u.id = %s 
                  AND u.tenant_id = %s
                  AND u.active = TRUE
                  AND t.active = TRUE;
            """, (user_id, tenant_id))
            
            user = cursor.fetchone()
            return dict(user) if user else None
            
        finally:
            conn.close()

