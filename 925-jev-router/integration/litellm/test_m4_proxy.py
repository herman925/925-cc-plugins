"""Local LiteLLM 1.106.2 proxy against loopback mocks.

Binds 127.0.0.1 only. Synthetic credentials only. Does not call
api.typesafe.ai or a provider. Does not request /anthropic/v1/messages.
"""

import json
import os
import signal
import socket
import subprocess
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from loopback_url import LoopbackURLError, RefuseRedirect, loopback_origin

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
VENV_PYTHON = ROOT / ".venv-m4" / "bin" / "python"
LITELLM_BIN = ROOT / ".venv-m4" / "bin" / "litellm"
PROXY_KEY = "synthetic-jev-m4-proxy-key"
PROXY_LOG = Path("/tmp/jev-m4-proxy.log")
NOCALLBACK_LOG = Path("/tmp/jev-m4-proxy-nocallback.log")

SERVICES = {}


def _clean_env(extra):
    drop = {
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "TYPESAFE_API_KEY",
        "AZURE_API_KEY",
        "GEMINI_API_KEY",
        "GROQ_API_KEY",
    }
    env = {key: value for key, value in os.environ.items() if key not in drop}
    env["NO_PROXY"] = "*"
    env["no_proxy"] = "*"
    env["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
    env["LITELLM_LOG"] = "ERROR"
    env.update(extra)
    return env


class _Proc:
    def __init__(self, proc, lines, log_path=None):
        self.proc = proc
        self.lines = lines
        self.log_path = log_path

    def stop(self):
        if self.proc.poll() is not None:
            return
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        deadline = time.time() + 5
        while time.time() < deadline and self.proc.poll() is None:
            time.sleep(0.1)
        if self.proc.poll() is None:
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if self.proc.stdout is not None:
            self.proc.stdout.close()
            self.proc.stdout = None


def _spawn(args, env, prefix, log_path=None):
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        text=True,
        bufsize=1,
        start_new_session=True,
        cwd=str(HERE),
    )
    lines = []
    ready = threading.Event()

    def drain():
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                lines.append(line)
                if log_path is not None:
                    with log_path.open("a", encoding="utf-8") as handle:
                        handle.write(line)
                if prefix and prefix in line:
                    ready.set()
        finally:
            proc.stdout.close()
            ready.set()

    threading.Thread(target=drain, daemon=True).start()
    if prefix:
        if not ready.wait(15):
            _Proc(proc, lines, log_path).stop()
            raise RuntimeError(f"timed out waiting for {prefix}: {''.join(lines[-30:])}")
        text = "".join(lines)
        if prefix not in text:
            _Proc(proc, lines, log_path).stop()
            raise RuntimeError(f"exited before {prefix}: {text}")
    return _Proc(proc, lines, log_path)


def _port_from(line, label):
    # "hook 127.0.0.1:1234"
    tail = line.strip().split(f"{label} 127.0.0.1:", 1)[1]
    return int(tail)


def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _request(method, url, payload=None, headers=None, timeout=90):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req_headers = {"content-type": "application/json"}
    if headers:
        req_headers.update(headers)
    request = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return response.status, raw, dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)


def _json_request(method, url, payload=None, headers=None, timeout=90):
    status, raw, headers_out = _request(method, url, payload, headers, timeout)
    text = raw.decode("utf-8", "replace")
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = None
    return status, parsed, text, headers_out


def _wait_health(url, proc, timeout):
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        if proc.proc.poll() is not None:
            raise RuntimeError(f"process exited before {url}: {''.join(proc.lines[-40:])}")
        try:
            status, _raw, _headers = _request("GET", url, timeout=2)
            if status == 200:
                return
            last = f"status {status}"
        except Exception as error:  # noqa: BLE001 - startup probe
            last = str(error)
        time.sleep(0.3)
    raise RuntimeError(f"health timeout {url}: {last}\n{''.join(proc.lines[-40:])}")


def _proxy_env(upstream_base, hook_url=None):
    extra = {"JEV_MOCK_UPSTREAM_BASE": upstream_base}
    if hook_url:
        extra["JEV_HOOK_URL"] = hook_url
    return _clean_env(extra)


def _start_proxy(config, port, env, log_path):
    log_path.write_text("", encoding="utf-8")
    proc = _spawn(
        [str(LITELLM_BIN), "--config", str(config), "--host", "127.0.0.1", "--port", str(port)],
        env,
        prefix="",
        log_path=log_path,
    )
    try:
        _wait_health(f"http://127.0.0.1:{port}/health/liveliness", proc, 180)
    except Exception:
        proc.stop()
        raise
    return proc


def _matching_line(proc, prefix):
    deadline = time.time() + 2
    while time.time() < deadline:
        for line in proc.lines:
            if prefix in line:
                return line
        time.sleep(0.05)
    raise RuntimeError(f"missing {prefix!r} in {''.join(proc.lines[-20:])}")


def setUpModule():
    if not VENV_PYTHON.is_file() or not LITELLM_BIN.is_file():
        raise RuntimeError("missing .venv-m4; see docs/m4-litellm-local-mock.md")
    try:
        _start_services()
    except Exception:
        tearDownModule()
        raise


def _start_services():
    typesafe = _spawn([str(VENV_PYTHON), str(HERE / "mock_typesafe.py")], _clean_env({}), "typesafe ")
    SERVICES["typesafe"] = typesafe
    upstream = _spawn([str(VENV_PYTHON), str(HERE / "mock_upstream.py")], _clean_env({}), "upstream ")
    SERVICES["upstream"] = upstream
    typesafe_port = _port_from(_matching_line(typesafe, "typesafe "), "typesafe")
    upstream_port = _port_from(_matching_line(upstream, "upstream "), "upstream")
    typesafe_base = f"http://127.0.0.1:{typesafe_port}"
    upstream_base = f"http://127.0.0.1:{upstream_port}/v1"
    hook = _spawn(
        ["node", str(HERE / "hook_server.mjs")],
        _clean_env({"JEV_TYPESAFE_BASE": typesafe_base}),
        "hook ",
    )
    SERVICES["hook"] = hook
    hook_port = _port_from(_matching_line(hook, "hook "), "hook")
    hook_url = f"http://127.0.0.1:{hook_port}"
    _wait_health(hook_url + "/health", hook, 10)
    proxy_port = _free_port()
    proxy = _start_proxy(
        HERE / "config.yaml",
        proxy_port,
        _proxy_env(upstream_base, hook_url),
        PROXY_LOG,
    )
    SERVICES.update(
        {
            "typesafe": typesafe,
            "upstream": upstream,
            "hook": hook,
            "proxy": proxy,
            "typesafe_base": typesafe_base,
            "upstream_base": upstream_base,
            "hook_url": hook_url,
            "proxy_url": f"http://127.0.0.1:{proxy_port}",
        }
    )


def tearDownModule():
    for name in ("proxy", "nocallback", "hook", "upstream", "typesafe"):
        proc = SERVICES.get(name)
        if proc is not None:
            proc.stop()


def _auth():
    return {"authorization": f"Bearer {PROXY_KEY}"}


def _stats(base):
    status, parsed, text, _headers = _json_request("GET", base + "/stats", timeout=10)
    if status != 200 or not isinstance(parsed, dict):
        raise AssertionError(f"stats {base} failed: {status} {text}")
    return parsed


def _post_control(base, path, payload):
    status, _parsed, text, _headers = _json_request("POST", base + path, payload, timeout=10)
    if status != 200:
        raise AssertionError(f"{base}{path} failed: {status} {text}")


def _alias(model, expected):
    if model == expected or model == f"openai/{expected}":
        return
    raise AssertionError(f"expected execute alias {expected}, upstream saw {model!r}")


_REJECTED_URLS = (
    "http://127.0.0.1:1234@example.invalid",
    "http://example.invalid:9",
    "https://127.0.0.1:9",
    "http://127.0.0.1:9/v1",
    "http://localhost:9",
    "http://127.0.0.1:9@127.0.0.1:8/",
)


class M4ProxyTests(unittest.TestCase):
    def setUp(self):
        _post_control(SERVICES["typesafe_base"], "/reset", {})
        _post_control(SERVICES["typesafe_base"], "/control", {"mode": "choice", "choice": "cheap-worker"})
        _post_control(SERVICES["upstream_base"].rsplit("/v1", 1)[0], "/reset", {})
        _post_control(SERVICES["upstream_base"].rsplit("/v1", 1)[0], "/control", {"mode": "ok"})
        _post_control(SERVICES["hook_url"], "/reset", {})

    def _upstream(self):
        return _stats(SERVICES["upstream_base"].rsplit("/v1", 1)[0])

    def _hook(self):
        return _stats(SERVICES["hook_url"])

    def _typesafe(self):
        return _stats(SERVICES["typesafe_base"])

    def _chat(self, payload, stream=False):
        return _request(
            "POST",
            SERVICES["proxy_url"] + "/v1/chat/completions",
            payload,
            _auth(),
            timeout=90,
        )

    def _messages(self, payload):
        headers = _auth()
        headers["anthropic-version"] = "2023-06-01"
        return _request(
            "POST",
            SERVICES["proxy_url"] + "/v1/messages",
            payload,
            headers,
            timeout=90,
        )

    def _assert_one_upstream(self, alias, stream):
        upstream = self._upstream()
        self.assertEqual(upstream["executions"], 1, upstream)
        recorded = upstream["requests"][0]
        _alias(recorded["model"], alias)
        self.assertEqual(recorded["stream"], stream)
        return recorded

    def test_00_loopback_url_rejects_userinfo_and_redirects(self):
        for value in _REJECTED_URLS:
            with self.subTest(value=value):
                with self.assertRaises(LoopbackURLError):
                    loopback_origin(value)
        self.assertEqual(loopback_origin("http://127.0.0.1:9"), "http://127.0.0.1:9")
        self.assertEqual(loopback_origin("http://[::1]:9/"), "http://[::1]:9")
        with self.assertRaises(LoopbackURLError):
            RefuseRedirect().redirect_request(None, None, 302, "Found", {}, "http://example.invalid/")
        script = """
import { assertLoopbackBase, LOOPBACK_REDIRECT } from './hook_server.mjs';
const reject = %s;
if (LOOPBACK_REDIRECT !== 'manual') throw new Error('redirect mode ' + LOOPBACK_REDIRECT);
for (const value of reject) {
  let threw = false;
  try { assertLoopbackBase(value); } catch { threw = true; }
  if (!threw) throw new Error('accepted ' + value);
}
if (assertLoopbackBase('http://127.0.0.1:9') !== 'http://127.0.0.1:9') throw new Error('v4 origin');
if (assertLoopbackBase('http://[::1]:9/') !== 'http://[::1]:9') throw new Error('v6 origin');
""" % json.dumps(list(_REJECTED_URLS))
        env = _clean_env({})
        env.pop("JEV_TYPESAFE_BASE", None)
        env.pop("JEV_HOOK_URL", None)
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=HERE,
            env=env,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
        self.assertEqual(self._upstream()["executions"], 0)
        self.assertEqual(self._hook()["hookRequests"], 0)

    def test_01_chat_completions_rewrites_choice(self):
        status, raw, _headers = self._chat(
            {"model": "jev-router", "messages": [{"role": "user", "content": "Rename the helper."}]}
        )
        self.assertEqual(status, 200, raw)
        recorded = self._assert_one_upstream("cheap-worker", False)
        hook = self._hook()
        self.assertEqual(hook["selectorCalls"], 1)
        self.assertEqual(hook["hookRequests"], 1)
        self.assertEqual(hook["last"]["decision"]["reason"], "typesafe-choice")
        self.assertEqual(hook["last"]["outbound"]["model"], "cheap-worker")
        typesafe = self._typesafe()
        self.assertEqual(typesafe["calls"], 1)
        criteria = typesafe["bodies"][0]["questions"]["model"]["criteria"]
        self.assertEqual(set(criteria), {"cheap-worker", "strong-worker"})
        self.assertNotIn("project_id", typesafe["bodies"][0].get("state", {}))
        self.assertNotIn("large-leader", json.dumps(recorded["body"]))

    def test_02_leader_makes_zero_selector_calls(self):
        status, raw, _headers = self._chat(
            {"model": "large-leader", "messages": [{"role": "user", "content": "Review the patch."}]}
        )
        self.assertEqual(status, 200, raw)
        self._assert_one_upstream("large-leader", False)
        self.assertEqual(self._hook()["selectorCalls"], 0)
        self.assertEqual(self._hook()["hookRequests"], 1)
        self.assertEqual(self._hook()["last"]["decision"]["reason"], "leader-bypass")
        self.assertEqual(self._typesafe()["calls"], 0)

    def test_03_fail_open_after_two_transient_failures(self):
        _post_control(SERVICES["typesafe_base"], "/control", {"mode": "transient"})
        status, raw, _headers = self._chat(
            {"model": "jev-router", "messages": [{"role": "user", "content": "Rename the helper."}]}
        )
        self.assertEqual(status, 200, raw)
        self._assert_one_upstream("strong-worker", False)
        self.assertEqual(self._typesafe()["calls"], 2)
        self.assertEqual(self._hook()["selectorCalls"], 2)
        self.assertEqual(self._hook()["last"]["decision"]["reason"], "fallback-after-retry")
        self.assertEqual(self._hook()["last"]["decision"]["model"], "strong-worker")

    def test_03b_invalid_choice_uses_eligible_fallback(self):
        _post_control(SERVICES["typesafe_base"], "/control", {"mode": "bad-choice"})
        status, raw, _headers = self._chat(
            {"model": "jev-router", "messages": [{"role": "user", "content": "Rename the helper."}]}
        )
        self.assertEqual(status, 200, raw)
        self._assert_one_upstream("strong-worker", False)
        self.assertEqual(self._typesafe()["calls"], 1)
        self.assertEqual(self._hook()["last"]["decision"]["reason"], "fallback-invalid-choice")

    def test_04_messages_non_stream(self):
        status, raw, _headers = self._messages(
            {
                "model": "jev-router",
                "max_tokens": 32,
                "messages": [{"role": "user", "content": "Say hi."}],
            }
        )
        self.assertEqual(status, 200, raw)
        self._assert_one_upstream("cheap-worker", False)
        body = json.loads(raw.decode("utf-8"))
        self.assertTrue(body.get("type") == "message" or "content" in body, body)

    def test_05_messages_stream(self):
        status, raw, _headers = self._messages(
            {
                "model": "jev-router",
                "max_tokens": 32,
                "stream": True,
                "messages": [{"role": "user", "content": "Say hi."}],
            }
        )
        self.assertEqual(status, 200, raw)
        text = raw.decode("utf-8", "replace")
        content_at = text.find("synthetic-ok")
        stop_at = text.find("event: message_stop")
        self.assertGreater(content_at, -1, text[:800])
        self.assertGreater(stop_at, content_at, text[:800])
        recorded = self._assert_one_upstream("cheap-worker", True)
        self.assertGreater(recorded["bytes_sent"], 0)
        self.assertTrue(recorded["completed"], recorded)
        self.assertEqual(self._hook()["selectorCalls"], 1)

    def test_06_messages_tools_preserved(self):
        tools = [
            {
                "name": "lookup",
                "description": "Look up a synthetic fixture.",
                "input_schema": {
                    "type": "object",
                    "properties": {"q": {"type": "string"}},
                    "required": ["q"],
                },
            }
        ]
        messages = [
            {"role": "user", "content": "Look up the fixture."},
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_m4_lookup",
                        "name": "lookup",
                        "input": {"q": "fixture"},
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "toolu_m4_lookup",
                        "content": "synthetic tool result",
                    }
                ],
            },
        ]
        status, raw, _headers = self._messages(
            {
                "model": "jev-router",
                "max_tokens": 64,
                "tools": tools,
                "messages": messages,
            }
        )
        self.assertEqual(status, 200, raw)
        recorded = self._assert_one_upstream("cheap-worker", False)
        self.assertTrue(recorded["completed"], recorded)
        hook = self._hook()
        self.assertEqual(hook["last"]["inbound"]["model"], "jev-router")
        self.assertEqual(hook["last"]["inbound"]["tools"], tools)
        self.assertEqual(hook["last"]["inbound"]["messages"], messages)
        self.assertEqual(hook["last"]["outbound"]["model"], "cheap-worker")
        self.assertEqual(hook["last"]["outbound"]["tools"], tools)
        self.assertEqual(hook["last"]["outbound"]["messages"], messages)
        body = recorded["body"]
        upstream_tools = body.get("tools")
        self.assertEqual(
            upstream_tools,
            [
                {
                    "type": "function",
                    "name": "lookup",
                    "strict": False,
                    "description": "Look up a synthetic fixture.",
                    "parameters": tools[0]["input_schema"],
                }
            ],
            upstream_tools,
        )
        items = body.get("input")
        self.assertIsInstance(items, list, body)
        calls = [item for item in items if item.get("type") == "function_call"]
        outputs = [item for item in items if item.get("type") == "function_call_output"]
        self.assertEqual(len(calls), 1, items)
        self.assertEqual(calls[0]["call_id"], "toolu_m4_lookup")
        self.assertEqual(calls[0]["name"], "lookup")
        self.assertEqual(json.loads(calls[0]["arguments"]), {"q": "fixture"})
        self.assertEqual(len(outputs), 1, items)
        self.assertEqual(outputs[0]["call_id"], "toolu_m4_lookup")
        self.assertEqual(outputs[0]["output"], "synthetic tool result")
        client = json.loads(raw.decode("utf-8"))
        content = client.get("content")
        self.assertIsInstance(content, list, client)
        self.assertTrue(content, client)
        self.assertTrue(all(block.get("type") == "text" for block in content), content)
        self.assertTrue(all(block.get("type") != "tool_use" for block in content), content)
        self.assertEqual(client.get("stop_reason"), "end_turn", client)
        self.assertIn("synthetic-ok", json.dumps(client))

    def test_07_no_blind_retry_after_stream_starts(self):
        _post_control(SERVICES["upstream_base"].rsplit("/v1", 1)[0], "/control", {"mode": "mid-stream-fail"})
        try:
            _status, raw, _headers = self._chat(
                {
                    "model": "jev-router",
                    "stream": True,
                    "messages": [{"role": "user", "content": "Stream a sentence."}],
                }
            )
        except urllib.error.URLError as error:
            raw = str(error).encode()
        upstream = self._upstream()
        self.assertEqual(upstream["executions"], 1, upstream)
        recorded = upstream["requests"][0]
        _alias(recorded["model"], "cheap-worker")
        self.assertTrue(recorded["stream"])
        self.assertGreater(recorded["bytes_sent"], 0)
        self.assertFalse(recorded["completed"], recorded)
        self.assertNotIn(b"[DONE]", raw)
        self.assertNotIn(b"message_stop", raw)
        self.assertEqual(self._hook()["selectorCalls"], 1)

    def test_08_callback_disabled_makes_zero_upstream_calls(self):
        before_upstream = self._upstream()["executions"]
        before_hook = self._hook()["hookRequests"]
        port = _free_port()
        proc = _start_proxy(
            HERE / "config.nocallback.yaml",
            port,
            _proxy_env(SERVICES["upstream_base"]),
            NOCALLBACK_LOG,
        )
        SERVICES["nocallback"] = proc
        try:
            status, raw, _headers = _request(
                "POST",
                f"http://127.0.0.1:{port}/v1/chat/completions",
                {"model": "jev-router", "messages": [{"role": "user", "content": "This must not execute."}]},
                _auth(),
                timeout=60,
            )
            message_headers = _auth()
            message_headers["anthropic-version"] = "2023-06-01"
            message_status, message_raw, _message_headers = _request(
                "POST",
                f"http://127.0.0.1:{port}/v1/messages",
                {
                    "model": "jev-router",
                    "max_tokens": 16,
                    "messages": [{"role": "user", "content": "This must not execute."}],
                },
                message_headers,
                timeout=60,
            )
        finally:
            proc.stop()
            SERVICES["nocallback"] = None
        self.assertGreaterEqual(status, 400, raw)
        text = raw.decode("utf-8", "replace")
        self.assertIn("sentinel_inert", text)
        self.assertNotIn("synthetic-ok", text)
        self.assertGreaterEqual(message_status, 400, message_raw)
        message_text = message_raw.decode("utf-8", "replace")
        self.assertIn("sentinel_inert", message_text)
        self.assertNotIn("synthetic-ok", message_text)
        self.assertEqual(self._upstream()["executions"], before_upstream)
        self.assertEqual(self._hook()["hookRequests"], before_hook)


if __name__ == "__main__":
    unittest.main(verbosity=2)
