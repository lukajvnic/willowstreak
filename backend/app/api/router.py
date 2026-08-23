from fastapi import APIRouter

from app.api.health import router as health_router
from app.modules.entries.routes import router as entries_router
from app.modules.habits.routes import router as habits_router
from app.modules.users.routes import router as users_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(users_router)
api_router.include_router(habits_router)
api_router.include_router(entries_router)

router = api_router
