"""Thin Auth B adapter over LiteLLM 1.106.2 key lookup and route checks.

``validate_resolved_virtual_key`` runs against a duck-typed prisma client
whose user, team, and project reads return no row. A returned key is the
only success. Expired, blocked, other native rejects, and unexpected
dependency errors all deny. Empty ``allowed_routes`` still fail open inside
``is_virtual_key_allowed_to_call_route``; this adapter calls that path, then
denies because ``check_route_access`` on an empty collection is false.

Jev Apply and read-back need the exact sibling path in ``allowed_routes``
and ``key.project_id`` equal to the path project. A parent prefix is not a
grant. The mock Apply handler is called only after an allow.

No dashboard key, Vault item, gateway config, or ``custom_auth`` hook.
"""

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import unquote

import litellm
from fastapi import HTTPException
from starlette.requests import Request

from litellm.proxy._types import ProxyException, hash_token
from litellm.proxy.auth.auth_checks import get_key_object
from litellm.proxy.auth.resolvers.store import IdentityStore
from litellm.proxy.auth.route_checks import RouteChecks
from litellm.proxy.auth.user_api_key_auth import (
    user_api_key_auth_builder,
    validate_resolved_virtual_key,
)
from litellm.proxy.common_utils.user_api_key_cache import UserApiKeyCache

LOGGER = logging.getLogger("jev.auth_b")

# Synthetic value so the proxy builder does not take the "no master key"
# pass-through. It is not inserted, not a dashboard key, and not logged.
_SHAPE_CHECK_MASTER = "sk-jev-authb-proxy-master-not-a-real-key"

JEV_CONTROL = re.compile(r"^/jev/v1/projects/([^/]+)/(applied|apply)$")
_UNSAFE = re.compile(r"[\x00\s\\?#]")

_FN_HASH = "litellm.proxy._types.hash_token"
_FN_GET_KEY = "litellm.proxy.auth.auth_checks.get_key_object"
_FN_IDENTITY = "litellm.proxy.auth.resolvers.store.IdentityStore.resolve"
_FN_VALIDATE = "litellm.proxy.auth.user_api_key_auth.validate_resolved_virtual_key"
_FN_BUILDER = "litellm.proxy.auth.user_api_key_auth.user_api_key_auth_builder"
_FN_SHOULD = "litellm.proxy.auth.route_checks.RouteChecks.should_call_route"
_FN_CHECK = "litellm.proxy.auth.route_checks.RouteChecks.check_route_access"


@dataclass(frozen=True)
class Decision:
    allow: bool
    code: str
    principal: dict | None
    executed: tuple
    note: str = ""


def canonicalize(path):
    """Return a single absolute path, or None when the path must not be matched.

    Rejects userinfo-style junk, backslash, NUL, whitespace, query, fragment,
    empty / ``.`` / ``..`` segments, and a second percent-encoding pass so
    ``%252e`` cannot remain a dot segment. The raw path is not returned.
    """
    if not isinstance(path, str) or not path.startswith("/") or _UNSAFE.search(path):
        return None
    decoded = unquote(path)
    if "%" in decoded:
        decoded = unquote(decoded)
    if not decoded.startswith("/") or _UNSAFE.search(decoded) or "//" in decoded:
        return None
    parts = decoded.split("/")
    if any(part in ("", ".", "..") for part in parts[1:]):
        return None
    return decoded


def _request(method, path):
    safe = path if isinstance(path, str) and path.startswith("/") else "/"
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": safe,
            "raw_path": safe.encode("ascii", "ignore"),
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 9),
            "server": ("127.0.0.1", 80),
        }
    )


def _bearer(authorization):
    if not isinstance(authorization, str):
        return None
    match = re.fullmatch(r"Bearer[ \t]+(\S+)\s*", authorization, flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(1)


def _principal(key):
    routes = key.allowed_routes
    return {
        "token_id": key.token,
        "user_id": key.user_id,
        "project_id": key.project_id,
        "team_id": key.team_id,
        "allowed_routes": list(routes) if isinstance(routes, list) else [],
        "blocked": bool(key.blocked),
        "permissions": dict(key.permissions or {}),
    }


def _log(code, principal):
    if principal is None:
        LOGGER.info(
            "decision=%s token_id= user_id= project_id= team_id= allowed_routes= blocked= permissions=",
            code,
        )
        return
    LOGGER.info(
        "decision=%s token_id=%s user_id=%s project_id=%s team_id=%s allowed_routes=%s blocked=%s permissions=%s",
        code,
        principal["token_id"],
        principal["user_id"],
        principal["project_id"],
        principal["team_id"],
        principal["allowed_routes"],
        principal["blocked"],
        principal["permissions"],
    )


def _finish(allow, code, principal, executed, note=""):
    _log(code, principal)
    return Decision(allow, code, principal, tuple(executed), note)


def _exception_text(exc):
    parts = [getattr(exc, "detail", None), getattr(exc, "message", None)]
    return " ".join(str(part) for part in parts if part)


def _prisma_lock():
    """One lock per running loop so prisma_client swaps do not cross tests."""
    loop = asyncio.get_running_loop()
    lock = getattr(loop, "_jev_auth_b_prisma_lock", None)
    if lock is None:
        lock = asyncio.Lock()
        setattr(loop, "_jev_auth_b_prisma_lock", lock)
    return lock


async def _reject_non_virtual_key(store, token, method, path):
    """Run the proxy builder's pre-db ``sk-`` shape check and nothing further.

    The builder reaches that check only when a DB client is installed. The
    mock store is attached for that call and then restored. A non-``sk-``
    token is rejected before ``get_data``.
    """
    import litellm.proxy.proxy_server as proxy_server

    async with _prisma_lock():
        previous_master = proxy_server.master_key
        previous_client = proxy_server.prisma_client
        previous_login = os.environ.get("EXPERIMENTAL_UI_LOGIN")
        proxy_server.master_key = _SHAPE_CHECK_MASTER
        proxy_server.prisma_client = store
        os.environ["EXPERIMENTAL_UI_LOGIN"] = "false"
        try:
            await user_api_key_auth_builder(
                request=_request(method, path or "/"),
                api_key=f"Bearer {token}",
                azure_api_key_header="",
                anthropic_api_key_header=None,
                google_ai_studio_api_key_header=None,
                azure_apim_header=None,
                request_data={},
            )
        finally:
            proxy_server.master_key = previous_master
            proxy_server.prisma_client = previous_client
            if previous_login is None:
                os.environ.pop("EXPERIMENTAL_UI_LOGIN", None)
            else:
                os.environ["EXPERIMENTAL_UI_LOGIN"] = previous_login


def _proxy_exception(exc):
    """The DB-metrics wrapper imports Prisma while handling a missing key.

    That import is absent in this disposable venv, so ``ModuleNotFoundError``
    replaces the ``ProxyException`` on the way out. The original auth error
    is still on ``__context__``.
    """
    seen = set()
    current = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ProxyException):
            return current
        current = current.__context__ if current.__cause__ is None else current.__cause__
    return None


async def _lookup(store, digest, executed):
    cache = UserApiKeyCache()
    key = None
    try:
        key = await get_key_object(
            hashed_token=digest,
            prisma_client=store,
            user_api_key_cache=cache,
        )
    except Exception as exc:
        executed.append(_FN_GET_KEY)
        if _proxy_exception(exc) is None:
            raise
        key = None
    else:
        executed.append(_FN_GET_KEY)
    if key is None:
        try:
            await IdentityStore(store, cache).resolve(hashed_token=digest)
        except Exception as exc:
            executed.append(_FN_IDENTITY)
            if _proxy_exception(exc) is None:
                raise
            return None
        executed.append(_FN_IDENTITY)
        return None
    try:
        principal_obj = await IdentityStore(store, cache).resolve(hashed_token=digest)
    except Exception as exc:
        executed.append(_FN_IDENTITY)
        if _proxy_exception(exc) is None:
            raise
        return None
    executed.append(_FN_IDENTITY)
    return IdentityStore.key_from_principal(principal_obj)


def _chain(exc):
    seen = set()
    current = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__ if current.__cause__ is not None else current.__context__


def _denial(exc):
    """Map a validator failure to a closed decision. The exception text is not logged."""
    texts = []
    proxy = None
    native = False
    for current in _chain(exc):
        texts.append(_exception_text(current))
        args = getattr(current, "args", ())
        if args:
            texts.append(" ".join(str(arg) for arg in args if arg))
        if isinstance(current, ProxyException):
            proxy = current
            native = True
            kind = getattr(current, "type", None)
            texts.append(str(getattr(kind, "value", kind)))
        if isinstance(current, HTTPException):
            native = True
        if isinstance(current, litellm.BudgetExceededError):
            native = True
    blob = " ".join(part for part in texts if part)
    if "Key is blocked" in blob:
        return "revoked", "key-blocked"
    kind = getattr(proxy, "type", None) if proxy is not None else None
    kind_value = str(getattr(kind, "value", kind))
    if kind_value == "expired_key" or "Expired Key" in blob:
        return "expired", "expired-key"
    if native:
        return "rejected", "native-denial"
    return "rejected", "unexpected-error"


async def _validate(store, key, method, path, executed):
    """Run the native validator to completion.

    ``store.prisma`` answers user, team, and project reads with no row. A
    returned ``UserAPIKeyAuth`` is success. Every exception denies, and the
    route checks do not run.
    """
    import litellm.proxy.proxy_server as proxy_server

    async with _prisma_lock():
        previous_client = proxy_server.prisma_client
        proxy_server.prisma_client = store.prisma
        try:
            try:
                validated = await validate_resolved_virtual_key(
                    request=_request(method, path or "/"),
                    request_data={},
                    valid_token=key,
                    api_key="",
                    route=path or "/",
                    start_time=datetime.now(timezone.utc),
                    parent_otel_span=None,
                    end_user_id=None,
                    end_user_params={},
                    _end_user_object=None,
                )
            except Exception as exc:
                executed.append(_FN_VALIDATE)
                return None, _denial(exc)
            executed.append(_FN_VALIDATE)
            return validated, None
        finally:
            proxy_server.prisma_client = previous_client


def _routes_empty(key):
    routes = key.allowed_routes
    return not isinstance(routes, list) or len(routes) == 0


async def authorize(store, authorization, method, path):
    executed = []
    token = _bearer(authorization)
    if token is None:
        return _finish(False, "missing", None, executed)

    canonical = canonicalize(path)
    verb = str(method or "").upper()

    if not token.startswith("sk-"):
        executed.append(_FN_BUILDER)
        shape = False
        try:
            await _reject_non_virtual_key(store, token, verb or "GET", canonical)
        except Exception as exc:
            text = _exception_text(exc)
            shape = "expected to start with" in text and token not in text
        return _finish(False, "invalid", None, executed, "virtual-key-shape" if shape else "")

    executed.append(_FN_HASH)
    digest = hash_token(token)
    try:
        key = await _lookup(store, digest, executed)
    except Exception:
        return _finish(False, "rejected", None, executed, "unexpected-error")
    if key is None:
        return _finish(False, "invalid", None, executed)

    looked_up = _principal(key)
    validated, denial = await _validate(store, key, verb or "GET", canonical, executed)
    if denial is not None:
        code, note = denial
        return _finish(False, code, looked_up, executed, note)
    key = validated
    principal = _principal(key)

    if canonical is None:
        return _finish(False, "malformed", principal, executed)

    request = _request(verb or "GET", canonical)
    if _routes_empty(key):
        try:
            RouteChecks.should_call_route(route=canonical, valid_token=key, request=request)
        except HTTPException:
            pass
        executed.append(_FN_SHOULD)
        RouteChecks.check_route_access(
            route=canonical,
            allowed_routes=list(key.allowed_routes or []),
        )
        executed.append(_FN_CHECK)
        return _finish(False, "scope_missing", principal, executed, "empty-routes-fail-open")

    try:
        RouteChecks.should_call_route(route=canonical, valid_token=key, request=request)
    except HTTPException:
        executed.append(_FN_SHOULD)
        return _finish(False, "route_denied", principal, executed, "route-check")
    executed.append(_FN_SHOULD)

    if canonical.startswith("/jev/") and JEV_CONTROL.fullmatch(canonical) is None:
        return _finish(False, "route_denied", principal, executed, "exact-shape")

    match = JEV_CONTROL.fullmatch(canonical)
    if match is not None:
        routes = list(key.allowed_routes or [])
        granted = canonical in routes and RouteChecks.check_route_access(
            route=canonical,
            allowed_routes=routes,
        )
        executed.append(_FN_CHECK)
        if not granted:
            return _finish(False, "route_denied", principal, executed, "exact-grant")
        if key.project_id != match.group(1):
            return _finish(False, "route_denied", principal, executed, "project-binding")
        action = match.group(2)
        if action == "apply" and verb != "POST":
            return _finish(False, "route_denied", principal, executed, "method")
        if action == "applied" and verb != "GET":
            return _finish(False, "route_denied", principal, executed, "method")

    return _finish(True, "ok", principal, executed)


async def dispatch_control(store, authorization, method, path, bridge, body=None):
    """Call the mock Apply handler only when ``authorize`` allows that control route.

    A denial returns before ``bridge.apply`` / ``bridge.read``. The handler's
    synthetic verifier stays inside the bridge.
    """
    decision = await authorize(store, authorization, method, path)
    if not decision.allow:
        return decision, False, None
    canonical = canonicalize(path)
    if canonical is None or JEV_CONTROL.fullmatch(canonical) is None:
        return decision, False, None
    verb = str(method or "").upper()
    if verb == "POST":
        response = bridge.apply(canonical, body)
    else:
        response = bridge.read(canonical)
    return decision, True, response
