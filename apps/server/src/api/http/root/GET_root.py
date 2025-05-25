from fastapi import APIRouter


def create_root_router() -> APIRouter:
    router = APIRouter()

    @router.get("/")
    async def root():
        return {"message": "Hello, FastAPI!"}

    return router
