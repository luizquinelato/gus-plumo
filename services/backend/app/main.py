"""
Main FastAPI application entry point
Cache cleared - All SharedExpensePartner references removed
"""

import os
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from .routers import import_router, cartoes_router, auth_router, tenant_colors_router, dashboard_router, expenses_router, reports_router, excel_import_router, user_preferences_router, accounts_router, expense_sharing_router, benefit_card_statements_router, settings_router, balance_router, balance_closure_router, expense_templates_router, loans_router, users_router
from .core.logging_config import setup_logging, get_logger
import traceback

# Inicializa logging ANTES de criar a aplicação
setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Gerencia o ciclo de vida da aplicação."""
    # Startup
    logger.info("🚀 Gus Expenses Platform iniciando...")
    logger.info("📊 Sistema de logging ativo")
    yield
    # Shutdown
    logger.info("👋 Gus Expenses Platform encerrando...")


app = FastAPI(
    title="Plumo API",
    description="Plumo - Finanças leves, vida plena. Assuma a direção. Sinta a leveza.",
    version="0.1.0",
    lifespan=lifespan
)


# Exception handler global para capturar TODOS os erros
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Captura todas as exceções não tratadas e loga detalhes"""
    logger.error("=" * 80)
    logger.error(f"❌ EXCEÇÃO NÃO TRATADA!")
    logger.error(f"📍 URL: {request.method} {request.url.path}")
    logger.error(f"❌ Tipo: {type(exc).__name__}")
    logger.error(f"❌ Mensagem: {str(exc)}")
    logger.error(f"❌ Traceback:")
    logger.error(traceback.format_exc())
    logger.error("=" * 80)

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": f"Erro interno: {type(exc).__name__}: {str(exc)}",
            "type": type(exc).__name__
        }
    )


# Configure CORS — lido do env var CORS_ORIGINS (definido em .env.prod / .env.dev)
_cors_origins_raw = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:5174,http://localhost:3000"
)
_cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router.router)
app.include_router(import_router.router)
app.include_router(excel_import_router.router)
app.include_router(cartoes_router.router)
app.include_router(accounts_router.router)
app.include_router(expense_sharing_router.router)
app.include_router(benefit_card_statements_router.router)
app.include_router(tenant_colors_router.router)
app.include_router(dashboard_router.router)
app.include_router(expenses_router.router)
app.include_router(reports_router.router)
app.include_router(balance_router.router)
app.include_router(balance_closure_router.router)
app.include_router(user_preferences_router.router)
app.include_router(settings_router.router)
app.include_router(expense_templates_router.router)
app.include_router(loans_router.router)
app.include_router(users_router.router)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Welcome to Gus Expenses Platform API",
        "version": "0.1.0",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

