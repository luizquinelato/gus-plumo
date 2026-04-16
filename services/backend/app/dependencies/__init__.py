# -*- coding: utf-8 -*-
"""
Dependencies package for FastAPI
"""
from .auth import get_current_user, require_account

__all__ = ['get_current_user', 'require_account']

