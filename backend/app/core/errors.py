import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ValidationErrorField(BaseModel):
    field: str
    message: str


class ApiErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ApiErrorResponse(BaseModel):
    error: ApiErrorBody


class ApiError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers


def api_error_response(error: ApiError) -> JSONResponse:
    content = ApiErrorResponse(
        error=ApiErrorBody(code=error.code, message=error.message, details=error.details)
    ).model_dump()
    return JSONResponse(
        status_code=error.status_code, content=content, headers=error.headers
    )


def validation_field_name(location: tuple[str | int, ...]) -> str:
    parts = [str(part) for part in location if part not in {"body", "query", "path"}]
    return ".".join(parts) if parts else "request"


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    # ApiError bodies are deliberately sanitized for clients, so log the real
    # cause here. Client errors are expected, so only 5xx is worth the noise.
    if exc.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        cause = exc.__cause__
        logger.error(
            "API request failed: method=%s path=%s status=%s code=%s",
            request.method,
            request.url.path,
            exc.status_code,
            exc.code,
            exc_info=(type(cause), cause, cause.__traceback__) if cause else None,
        )
    return api_error_response(exc)


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    fields = [
        ValidationErrorField(
            field=validation_field_name(tuple(error.get("loc", ()))),
            message=str(error.get("msg", "Invalid value")),
        )
        for error in exc.errors()
    ]
    return api_error_response(
        ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="validation_error",
            message="Invalid request",
            details={"fields": [f.model_dump() for f in fields]},
        )
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    logger.warning(
        "Raw HTTPException leaked through API error handler: status=%s detail=%r",
        exc.status_code,
        exc.detail,
    )
    if exc.status_code == status.HTTP_404_NOT_FOUND:
        code, message = "not_found", "Not found"
    elif exc.status_code == status.HTTP_405_METHOD_NOT_ALLOWED:
        code, message = "method_not_allowed", "Method not allowed"
    elif 400 <= exc.status_code < 500:
        code, message = "request_error", "Request error"
    else:
        code, message = "internal_server_error", "Internal server error"

    return api_error_response(
        ApiError(
            status_code=exc.status_code,
            code=code,
            message=message,
            headers=dict(exc.headers) if exc.headers else None,
        )
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled API exception")
    return api_error_response(
        ApiError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="internal_server_error",
            message="Internal server error",
        )
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_exception_handler)  # type: ignore[arg-type]
