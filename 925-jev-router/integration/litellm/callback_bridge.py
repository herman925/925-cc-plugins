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
import json
import os
import urllib.error
import urllib.request

from litellm.integrations.custom_logger import CustomLogger

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
    hook_url = os.environ.get("JEV_HOOK_URL", "").rstrip("/")
    if not hook_url.startswith("http://127.0.0.1:"):
        raise RuntimeError("JEV_HOOK_URL must be the loopback Node adapter.")
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
        hook_url + "/pre-call",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            parsed = json.loads(response.read().decode("utf-8"))
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
