"""Loopback TypeSafe System One stub. Never dials api.typesafe.ai."""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.mode = "choice"
        self.choice = "cheap-worker"
        self.calls = 0
        self.bodies = []


STATE = State()


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

    def _read(self):
        length = int(self.headers.get("content-length", "0") or 0)
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True})
            return
        if self.path == "/stats":
            with STATE.lock:
                self._json(200, {"calls": STATE.calls, "mode": STATE.mode, "choice": STATE.choice, "bodies": STATE.bodies})
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path == "/reset":
            with STATE.lock:
                STATE.calls = 0
                STATE.bodies = []
            self._json(200, {"ok": True})
            return
        if self.path == "/control":
            body = self._read()
            with STATE.lock:
                if "mode" in body:
                    STATE.mode = body["mode"]
                if "choice" in body:
                    STATE.choice = body["choice"]
                mode = STATE.mode
                choice = STATE.choice
            self._json(200, {"ok": True, "mode": mode, "choice": choice})
            return
        if self.path == "/v1/systemone":
            body = self._read()
            with STATE.lock:
                STATE.calls += 1
                STATE.bodies.append(body)
                mode = STATE.mode
                choice = STATE.choice
            if mode == "transient":
                self._json(503, {"error": "synthetic-transient"})
                return
            if mode == "bad-choice":
                self._json(200, {"answers": {"model": {"choice": "not-on-the-approved-list"}}})
                return
            self._json(200, {"answers": {"model": {"choice": choice}}})
            return
        self._json(404, {"error": "not_found"})


def main():
    port = int(os.environ.get("JEV_TYPESAFE_PORT", "0"))
    httpd = ThreadingHTTPServer((HOST, port), Handler)
    print(f"typesafe {HOST}:{httpd.server_address[1]}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
