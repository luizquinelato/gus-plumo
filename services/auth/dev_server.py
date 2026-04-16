#!/usr/bin/env python3
"""
Script para iniciar o servidor de desenvolvimento do Auth Service
"""

import uvicorn
from app.core.config import get_settings

if __name__ == "__main__":
    settings = get_settings()
    
    print("🚀 Iniciando Gus Expenses - Serviço de Autenticação")
    print(f"📍 Host: {settings.HOST}")
    print(f"🔌 Porta: {settings.PORT}")
    print(f"🗄️  Banco: {settings.DB_NAME}")
    print()
    
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
        log_level="info"
    )

