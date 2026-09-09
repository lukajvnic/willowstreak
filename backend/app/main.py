from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.errors import register_exception_handlers


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version="0.1.0")

    register_exception_handlers(app)

    if settings.backend_cors_origins:
        # willo.app -> api.willo.app is still cross-origin. Sessions ride as
        # Bearer headers (supabase-js owns storage and refresh), not cookies,
        # so credentials stay off.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.backend_cors_origins,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
