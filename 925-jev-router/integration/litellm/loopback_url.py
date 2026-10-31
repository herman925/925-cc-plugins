"""Parse a loopback origin and refuse redirects. Stdlib only.

A prefix check accepts ``http://127.0.0.1:1234@example.invalid`` because the
text starts with a loopback host. ``urlsplit`` puts that host in the userinfo
and the real host in ``hostname``. This module rejects userinfo and any host
that is not a literal loopback address, then rebuilds the origin from the
parsed host and port.
"""

import urllib.parse
import urllib.request


class LoopbackURLError(ValueError):
    pass


def loopback_origin(value):
    if not isinstance(value, str) or value == "" or value.strip() != value:
        raise LoopbackURLError("loopback URL must be a non-empty string.")
    parsed = urllib.parse.urlsplit(value)
    if parsed.username is not None or parsed.password is not None:
        raise LoopbackURLError("loopback URL rejects userinfo.")
    if parsed.scheme != "http":
        raise LoopbackURLError("loopback URL must be http.")
    host = parsed.hostname
    if host not in {"127.0.0.1", "::1"}:
        raise LoopbackURLError("loopback URL host is not loopback.")
    if parsed.port is None or not 1 <= parsed.port <= 65535:
        raise LoopbackURLError("loopback URL requires an explicit port.")
    if parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise LoopbackURLError("loopback URL rejects a path, query, or fragment.")
    bracket = f"[{host}]" if host == "::1" else host
    return f"http://{bracket}:{parsed.port}"


class RefuseRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise LoopbackURLError("loopback URL client refuses redirects.")


def open_loopback(request, timeout):
    opener = urllib.request.build_opener(RefuseRedirect)
    return opener.open(request, timeout=timeout)
