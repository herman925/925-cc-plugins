"""Loopback OpenAI-compatible chat completions stub. Never dials a provider."""

import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.mode = "ok"
        self.executions = 0
        self.requests = []


STATE = State()


EXECUTE_PATHS = {
    "/v1/chat/completions",
    "/chat/completions",
    "/v1/responses",
    "/responses",
}


def _chunk(model, delta, finish):
    payload = {
        "id": "chatcmpl-m4",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    return f"data: {json.dumps(payload)}\n\n".encode("utf-8")


def _responses_body(model):
    return {
        "id": "resp_m4",
        "object": "response",
        "created_at": 0,
        "status": "completed",
        "model": model,
        "output": [
            {
                "type": "message",
                "id": "msg_m4",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "output_text", "text": "synthetic-ok", "annotations": []}],
            }
        ],
        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
    }


def _sse(event, payload):
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n".encode("utf-8")


def _responses_stream(model):
    return b"".join(
        [
            _sse(
                "response.output_text.delta",
                {
                    "type": "response.output_text.delta",
                    "delta": "synthetic-ok",
                    "item_id": "msg_m4",
                    "output_index": 0,
                    "content_index": 0,
                },
            ),
            _sse(
                "response.completed",
                {"type": "response.completed", "response": _responses_body(model)},
            ),
        ]
    )


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def _json(self, code, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_raw(self):
        encoding = (self.headers.get("transfer-encoding") or "").lower()
        if "chunked" in encoding:
            chunks = []
            while True:
                line = self.rfile.readline()
                if not line:
                    break
                size = int(line.strip().split(b";", 1)[0] or b"0", 16)
                if size == 0:
                    while True:
                        trailer = self.rfile.readline()
                        if trailer in (b"\r\n", b"\n", b""):
                            break
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)
            return b"".join(chunks)
        length = int(self.headers.get("content-length", "0") or 0)
        return self.rfile.read(length) if length else b""

    def _read(self):
        raw = self._read_raw()
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True})
            return
        if self.path == "/stats":
            with STATE.lock:
                self._json(200, {"executions": STATE.executions, "mode": STATE.mode, "requests": STATE.requests})
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path == "/reset":
            self._read_raw()
            with STATE.lock:
                STATE.executions = 0
                STATE.requests = []
            self._json(200, {"ok": True})
            return
        if self.path == "/control":
            body = self._read()
            with STATE.lock:
                if "mode" in body:
                    STATE.mode = body["mode"]
                mode = STATE.mode
            self._json(200, {"ok": True, "mode": mode})
            return
        path = self.path.split("?", 1)[0]
        body = self._read()
        if path not in EXECUTE_PATHS:
            self._json(404, {"error": "not_found", "path": path})
            return
        model = body.get("model")
        stream = bool(body.get("stream"))
        recorded = {
            "path": path,
            "model": model,
            "stream": stream,
            "body": body,
            "bytes_sent": 0,
        }
        with STATE.lock:
            STATE.executions += 1
            STATE.requests.append(recorded)
            mode = STATE.mode
        responses = path.endswith("/responses")
        if stream and mode == "mid-stream-fail":
            partial = (
                _sse(
                    "response.output_text.delta",
                    {"type": "response.output_text.delta", "delta": "partial", "item_id": "msg_m4"},
                )
                if responses
                else _chunk(model or "mock", {"content": "partial"}, None)
            )
            self._start_stream(recorded, partial)
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.close_connection = True
            return
        if stream:
            payload = _responses_stream(model or "mock") if responses else b"".join(
                [
                    _chunk(model or "mock", {"role": "assistant", "content": ""}, None),
                    _chunk(model or "mock", {"content": "synthetic-ok"}, None),
                    _chunk(model or "mock", {}, "stop"),
                    b"data: [DONE]\n\n",
                ]
            )
            self._start_stream(recorded, payload)
            self._end_chunked()
            return
        if responses:
            payload = _responses_body(model)
            raw = json.dumps(payload).encode("utf-8")
            recorded["bytes_sent"] = len(raw)
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        payload = {
            "id": "chatcmpl-m4",
            "object": "chat.completion",
            "created": 0,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "synthetic-ok"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }
        raw = json.dumps(payload).encode("utf-8")
        recorded["bytes_sent"] = len(raw)
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _start_stream(self, recorded, payload):
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.send_header("transfer-encoding", "chunked")
        self.end_headers()
        self._write_chunk(payload)
        recorded["bytes_sent"] = len(payload)

    def _write_chunk(self, payload):
        self.wfile.write(f"{len(payload):X}\r\n".encode("ascii") + payload + b"\r\n")
        self.wfile.flush()

    def _end_chunked(self):
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()


def main():
    port = int(os.environ.get("JEV_UPSTREAM_PORT", "0"))
    httpd = ThreadingHTTPServer((HOST, port), Handler)
    print(f"upstream {HOST}:{httpd.server_address[1]}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
