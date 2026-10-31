"""LiteLLM CustomLogger bridge. Policy stays in the Node hook.

async_pre_call_hook posts the JSON-safe request fields to the loopback Node
adapter. That adapter calls planPreCall in src/hook.mjs (the function
asyncPreCallHook delegates to) and returns the rewritten model. This module
does not choose a model, does not read identity headers, and does not call
api.typesafe.ai.

M3 request-context stickiness is not on this path. src/hook.mjs does not
consult src/request-context.mjs, and this callback does not call it either.
"""

import asyncio
import importlib.util
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from litellm.integrations.custom_logger import CustomLogger

_loopback_path = Path(__file__).resolve().with_name("loopback_url.py")
_loopback_spec = importlib.util.spec_from_file_location("jev_m4_loopback_url", _loopback_path)
if _loopback_spec is None or _loopback_spec.loader is None:
    raise RuntimeError("loopback URL parser is missing.")
_loopback = importlib.util.module_from_spec(_loopback_spec)
_loopback_spec.loader.exec_module(_loopback)

_FORWARD_KEYS = (
    "model",
    "messages",
    "tools",
    "tool_choice",
    "system",
    "max_tokens",
    "stream",
    "temperature",
)


def _json_ready(value):
    try:
        json.dumps(value)
    except TypeError:
        return None
    return value


def _call_hook(data):
    try:
        origin = _loopback.loopback_origin(os.environ.get("JEV_HOOK_URL", ""))
    except _loopback.LoopbackURLError as error:
        raise RuntimeError(str(error)) from error
    payload = {}
    for key in _FORWARD_KEYS:
        if key not in data:
            continue
        ready = _json_ready(data[key])
        if ready is not None:
            payload[key] = ready
    if "model" not in payload:
        raise RuntimeError("jev hook was given a request with no JSON model.")
    request = urllib.request.Request(
        origin + "/pre-call",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with _loopback.open_loopback(request, timeout=20) as response:
            parsed = json.loads(response.read().decode("utf-8"))
    except _loopback.LoopbackURLError as error:
        raise RuntimeError(str(error)) from error
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise RuntimeError(f"jev hook rejected the request: {detail}") from error
    model = parsed.get("data", {}).get("model") if isinstance(parsed, dict) else None
    if not isinstance(model, str) or model == "" or model == "jev-router":
        raise RuntimeError("jev hook did not return an execute model.")
    return model


class JevRouterCallback(CustomLogger):
    def __init__(self):
        super().__init__()

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        model = await asyncio.to_thread(_call_hook, data)
        data["model"] = model
        return data


proxy_handler_instance = JevRouterCallback()
