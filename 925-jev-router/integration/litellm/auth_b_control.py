"""Node bridge to the existing mock Apply handler.

The synthetic verifier token is the one ``createMockControlPlane`` already
requires. It is not an Auth B virtual key and it is not sent until the
gate has allowed the call.
"""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRIDGE = Path(__file__).with_name("mock_apply_bridge.mjs")
SYNTHETIC_VERIFIER = "synthetic-jev-authb-mock-verifier"
ALIASES = ["cheap-worker", "strong-worker", "large-leader"]


class MockApplyBridge:
    def __init__(self):
        self.calls = 0
        self.proc = subprocess.Popen(
            ["node", str(BRIDGE)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=ROOT,
            text=True,
            bufsize=1,
        )
        self._send({"op": "init", "token": SYNTHETIC_VERIFIER, "aliases": ALIASES})
        ready = self._read()
        if not ready.get("ok"):
            self.close()
            raise RuntimeError("mock apply bridge did not start")

    def _send(self, payload):
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def _read(self):
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("mock apply bridge closed")
        return json.loads(line)

    def apply(self, path, policy):
        self.calls += 1
        self._send({"op": "apply", "path": path, "policy": policy})
        return self._read()

    def read(self, path):
        self.calls += 1
        self._send({"op": "read", "path": path})
        return self._read()

    def close(self):
        if self.proc.poll() is not None:
            return
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=2)
