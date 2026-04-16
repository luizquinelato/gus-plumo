"""
Modelos de autenticação e autorização.
Autor: Gus Expenses Platform
Data: 2025-12-29
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.models.base_entity import now_utc


class Tenant(Base):
    """Modelo para tabela tenants."""
    __tablename__ = 'tenants'

    # 1. Campos de negócio
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)
    website = Column(String)
    assets_folder = Column(String(100))
    logo_filename = Column(String(255), default='default-logo.png')
    color_schema_mode = Column(String(10), default='default')
    tier = Column(String(20), nullable=False, default='premium')

    # 2. Campos de auditoria
    created_at = Column(DateTime, nullable=False, default=now_utc)
    last_updated_at = Column(DateTime, nullable=False, default=now_utc, onupdate=now_utc)

    # 3. Active
    active = Column(Boolean, nullable=False, default=True)

    # Relacionamentos
    users = relationship("Usuario", back_populates="tenant")


class Usuario(Base):
    """Modelo para tabela users."""
    __tablename__ = 'users'

    # 1. Campos de negócio
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True)
    email = Column(String(255), nullable=False)
    first_name = Column(String(100))
    last_name = Column(String(100))
    role = Column(String(50), nullable=False, default='user')
    is_admin = Column(Boolean, default=False)
    auth_provider = Column(String(50), nullable=False, default='local')
    password_hash = Column(String(255))
    theme_mode = Column(String(10), default='light')
    high_contrast_mode = Column(Boolean, default=False)
    reduce_motion = Column(Boolean, default=False)
    colorblind_safe_palette = Column(Boolean, default=False)
    accessibility_level = Column(String(10), default='regular')
    profile_image_filename = Column(String(255))
    last_login_at = Column(DateTime)

    # 2. Campos de auditoria
    created_at = Column(DateTime, nullable=False, default=now_utc)
    last_updated_at = Column(DateTime, nullable=False, default=now_utc, onupdate=now_utc)

    # 3. Active
    active = Column(Boolean, nullable=False, default=True)

    # Relacionamentos
    tenant = relationship("Tenant", back_populates="users")
    sessions = relationship("Sessao", back_populates="user")
    permissions = relationship("Permissao", back_populates="user")


class Sessao(Base):
    """Modelo para tabela users_sessions."""
    __tablename__ = 'users_sessions'

    # 1. Campos de negócio
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    ip_address = Column(String(45))
    user_agent = Column(Text)

    # 2. Campos de auditoria
    created_at = Column(DateTime, nullable=False, default=now_utc)
    last_updated_at = Column(DateTime, nullable=False, default=now_utc, onupdate=now_utc)

    # 3. Active
    active = Column(Boolean, nullable=False, default=True)

    # Relacionamentos
    user = relationship("Usuario", back_populates="sessions")


class Permissao(Base):
    """Modelo para tabela users_permissions."""
    __tablename__ = 'users_permissions'

    # 1. Campos de negócio
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    resource = Column(String(100), nullable=False, index=True)
    action = Column(String(50), nullable=False)
    granted = Column(Boolean, nullable=False, default=True)

    # 2. Campos de auditoria
    created_at = Column(DateTime, nullable=False, default=now_utc)
    last_updated_at = Column(DateTime, nullable=False, default=now_utc, onupdate=now_utc)

    # 3. Active
    active = Column(Boolean, nullable=False, default=True)

    # Relacionamentos
    user = relationship("Usuario", back_populates="permissions")


class ConfiguracaoSistema(Base):
    """Modelo para tabela system_settings."""
    __tablename__ = 'system_settings'

    # 1. Campos de negócio
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True)
    setting_key = Column(String, nullable=False, index=True)
    setting_value = Column(String, nullable=False)
    setting_type = Column(String, nullable=False, default='string')
    description = Column(String)

    # 2. Campos de auditoria
    created_at = Column(DateTime, nullable=False, default=now_utc)
    last_updated_at = Column(DateTime, nullable=False, default=now_utc, onupdate=now_utc)

    # 3. Active
    active = Column(Boolean, nullable=False, default=True)


class TenantCores(Base):
    """Modelo para tabela tenants_colors."""
    __tablename__ = 'tenants_colors'

    # 1. Campos de negócio
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True)
    color_schema_mode = Column(String(10), nullable=False)
    accessibility_level = Column(String(10), nullable=False)
    theme_mode = Column(String(5), nullable=False)
    color1 = Column(String(7))
    color2 = Column(String(7))
    color3 = Column(String(7))
    color4 = Column(String(7))
    color5 = Column(String(7))
    on_color1 = Column(String(7))
    on_color2 = Column(String(7))
    on_color3 = Column(String(7))
    on_color4 = Column(String(7))
    on_color5 = Column(String(7))
    on_gradient_1_2 = Column(String(7))
    on_gradient_2_3 = Column(String(7))
    on_gradient_3_4 = Column(String(7))
    on_gradient_4_5 = Column(String(7))
    on_gradient_5_1 = Column(String(7))

    # 2. Campos de auditoria
    created_at = Column(DateTime, nullable=False, default=now_utc)
    last_updated_at = Column(DateTime, nullable=False, default=now_utc, onupdate=now_utc)

    # 3. Active
    active = Column(Boolean, nullable=False, default=True)

