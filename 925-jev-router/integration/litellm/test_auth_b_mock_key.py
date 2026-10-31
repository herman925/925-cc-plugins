"""Auth B mock-key gate. LiteLLM 1.106.2 functions, in-memory key rows.

Synthetic fixtures only. Does not mint a key, read Vault, or call a gateway.
"""

import logging
import unittest

from fastapi import HTTPException
from litellm.proxy._types import GenerateKeyRequest, LiteLLMKeyType, UserAPIKeyAuth
from litellm.proxy.auth.route_checks import RouteChecks
from litellm.proxy.management_endpoints.key_management_endpoints import handle_key_type

from auth_b_gate import authorize, canonicalize
from auth_b_mock_store import MockKeyStore

PROJECT = "orca-ade-example"
APPLY = f"/jev/v1/projects/{PROJECT}/apply"
APPLIED = f"/jev/v1/projects/{PROJECT}/applied"
OTHER_APPLY = "/jev/v1/projects/orca-other/apply"
NEIGHBOR_APPLY = "/jev/v1/projects/orca-ade-example-evil/apply"
CHAT = "/v1/chat/completions"
MESSAGES = "/v1/messages"

SCOPED = "sk-jev-authb-scoped-not-a-real-key"
INFER = "sk-jev-authb-infer-not-a-real-key"
READ = "sk-jev-authb-read-not-a-real-key"
BLOCKED = "sk-jev-authb-blocked-not-a-real-key"
MISSING_KEY = "sk-jev-authb-missing-not-a-real-key"
EMPTY = "sk-jev-authb-empty-not-a-real-key"
NONE_ROUTES = "sk-jev-authb-noroutes-not-a-real-key"
PERMS = "sk-jev-authb-perms-not-a-real-key"
NOT_SK = "not-a-virtual-key"

SECRETS = (SCOPED, INFER, READ, BLOCKED, MISSING_KEY, EMPTY, NONE_ROUTES, PERMS, NOT_SK)

_FN_SHOULD = "litellm.proxy.auth.route_checks.RouteChecks.should_call_route"
_FN_CHECK = "litellm.proxy.auth.route_checks.RouteChecks.check_route_access"
_FN_GET_KEY = "litellm.proxy.auth.auth_checks.get_key_object"
_FN_IDENTITY = "litellm.proxy.auth.resolvers.store.IdentityStore.resolve"
_FN_VALIDATE = "litellm.proxy.auth.user_api_key_auth.validate_resolved_virtual_key"
_FN_BUILDER = "litellm.proxy.auth.user_api_key_auth.user_api_key_auth_builder"
_FN_HASH = "litellm.proxy._types.hash_token"


class _SecretGuard(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.hits = []

    def emit(self, record):
        try:
            text = record.getMessage()
        except Exception:
            text = str(record.msg)
        for secret in SECRETS:
            if secret in text:
                self.hits.append((record.name, secret))


def _llm_routes():
    data = handle_key_type(GenerateKeyRequest(key_type=LiteLLMKeyType.LLM_API), {})
    return list(data["allowed_routes"])


def _info_routes():
    data = handle_key_type(GenerateKeyRequest(key_type=LiteLLMKeyType.READ_ONLY), {})
    return list(data["allowed_routes"])


class AuthBMockKeyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.guard = _SecretGuard()
        logging.getLogger().addHandler(self.guard)
        self.addCleanup(logging.getLogger().removeHandler, self.guard)
        self.store = MockKeyStore()
        self.store.insert(
            SCOPED,
            token_id="tok-scoped-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=[APPLY, APPLIED, "llm_api_routes"],
            permissions={"jev": "apply-and-read"},
        )
        self.store.insert(
            INFER,
            token_id="tok-infer-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=_llm_routes(),
        )
        self.store.insert(
            READ,
            token_id="tok-read-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=[APPLIED, *_info_routes()],
        )
        self.store.insert(
            BLOCKED,
            token_id="tok-blocked-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=[APPLY, APPLIED, "llm_api_routes"],
            blocked=True,
        )
        self.store.insert(
            EMPTY,
            token_id="tok-empty-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=[],
            permissions={"jev": "apply"},
        )
        self.store.insert(
            NONE_ROUTES,
            token_id="tok-none-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=None,
        )
        self.store.insert(
            PERMS,
            token_id="tok-perms-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=[],
            permissions={"apply": True},
        )

    def assertNoSecretLogs(self):
        self.assertEqual(self.guard.hits, [])

    async def _auth(self, secret, method, path, header=True):
        authorization = None if not header else f"Bearer {secret}"
        return await authorize(self.store, authorization, method, path)

    async def test_scoped_key_accepts_apply_read_and_inference(self):
        apply = await self._auth(SCOPED, "POST", APPLY)
        read = await self._auth(SCOPED, "GET", APPLIED)
        chat = await self._auth(SCOPED, "POST", CHAT)
        messages = await self._auth(SCOPED, "POST", MESSAGES)
        for decision in (apply, read, chat, messages):
            self.assertTrue(decision.allow)
            self.assertEqual(decision.code, "ok")
            self.assertEqual(decision.principal["token_id"], "tok-scoped-orca")
            self.assertEqual(decision.principal["project_id"], PROJECT)
            self.assertIn(_FN_HASH, decision.executed)
            self.assertIn(_FN_GET_KEY, decision.executed)
            self.assertIn(_FN_IDENTITY, decision.executed)
            self.assertIn(_FN_VALIDATE, decision.executed)
            self.assertIn(_FN_SHOULD, decision.executed)
            self.assertNotIn(SCOPED, str(decision.principal))
        self.assertEqual(apply.principal["allowed_routes"], [APPLY, APPLIED, "llm_api_routes"])
        self.assertNotIn(f"/jev/v1/projects/{PROJECT}", apply.principal["allowed_routes"])
        wrong_apply = await self._auth(SCOPED, "GET", APPLY)
        wrong_read = await self._auth(SCOPED, "POST", APPLIED)
        self.assertFalse(wrong_apply.allow)
        self.assertEqual(wrong_apply.note, "method")
        self.assertFalse(wrong_read.allow)
        self.assertEqual(wrong_read.note, "method")
        self.assertNoSecretLogs()

    async def test_missing_invalid_and_revoked(self):
        missing = await authorize(self.store, None, "POST", APPLY)
        self.assertFalse(missing.allow)
        self.assertEqual(missing.code, "missing")
        self.assertEqual(missing.executed, ())
        self.assertIsNone(missing.principal)

        blank = await authorize(self.store, "Bearer", "POST", APPLY)
        self.assertEqual(blank.code, "missing")

        invalid = await self._auth(MISSING_KEY, "POST", APPLY)
        self.assertFalse(invalid.allow)
        self.assertEqual(invalid.code, "invalid")
        self.assertIsNone(invalid.principal)
        self.assertIn(_FN_GET_KEY, invalid.executed)
        self.assertIn(_FN_IDENTITY, invalid.executed)
        self.assertNotIn(_FN_SHOULD, invalid.executed)

        shape = await self._auth(NOT_SK, "POST", CHAT)
        self.assertEqual(shape.code, "invalid")
        self.assertEqual(shape.note, "virtual-key-shape")
        self.assertEqual(shape.executed, (_FN_BUILDER,))
        self.assertNotIn(NOT_SK, str(shape))

        revoked = await self._auth(BLOCKED, "POST", APPLY)
        self.assertFalse(revoked.allow)
        self.assertEqual(revoked.code, "revoked")
        self.assertEqual(revoked.note, "key-blocked")
        self.assertTrue(revoked.principal["blocked"])
        self.assertEqual(revoked.principal["token_id"], "tok-blocked-orca")
        self.assertIn(_FN_VALIDATE, revoked.executed)
        self.assertNotIn(_FN_SHOULD, revoked.executed)
        self.assertNoSecretLogs()

    async def test_inference_only_denies_apply(self):
        self.assertEqual(_llm_routes(), ["llm_api_routes"])
        chat = await self._auth(INFER, "POST", CHAT)
        messages = await self._auth(INFER, "POST", MESSAGES)
        apply = await self._auth(INFER, "POST", APPLY)
        read = await self._auth(INFER, "GET", APPLIED)
        self.assertTrue(chat.allow)
        self.assertTrue(messages.allow)
        self.assertFalse(apply.allow)
        self.assertEqual(apply.code, "route_denied")
        self.assertEqual(apply.note, "route-check")
        self.assertFalse(read.allow)
        self.assertEqual(read.code, "route_denied")
        self.assertNoSecretLogs()

    async def test_read_only_denies_writes(self):
        self.assertEqual(_info_routes(), ["info_routes"])
        read = await self._auth(READ, "GET", APPLIED)
        info = await self._auth(READ, "GET", "/key/info")
        apply = await self._auth(READ, "POST", APPLY)
        generate = await self._auth(READ, "POST", "/key/generate")
        team = await self._auth(READ, "POST", "/team/new")
        user = await self._auth(READ, "POST", "/user/new")
        self.assertTrue(read.allow)
        self.assertTrue(info.allow)
        for denied in (apply, generate, team, user):
            self.assertFalse(denied.allow)
            self.assertEqual(denied.code, "route_denied")
            self.assertEqual(denied.note, "route-check")
        self.assertNoSecretLogs()

    async def test_unrelated_admin_paths_denied_for_scoped_key(self):
        for path in ("/key/generate", "/team/new", "/user/new"):
            decision = await self._auth(SCOPED, "POST", path)
            self.assertFalse(decision.allow, path)
            self.assertEqual(decision.code, "route_denied")
            self.assertEqual(decision.note, "route-check")
        self.assertNoSecretLogs()

    async def test_cross_project_and_neighbor_denied(self):
        cross = await self._auth(SCOPED, "POST", OTHER_APPLY)
        neighbor = await self._auth(SCOPED, "POST", NEIGHBOR_APPLY)
        self.assertFalse(cross.allow)
        self.assertEqual(cross.code, "route_denied")
        self.assertFalse(neighbor.allow)
        self.assertEqual(neighbor.code, "route_denied")
        self.assertFalse(
            RouteChecks._route_matches_allowed_route(route=NEIGHBOR_APPLY, allowed_route=APPLY)
        )
        self.assertNoSecretLogs()

    async def test_empty_or_missing_scope_fails_jev_permission(self):
        bare = UserAPIKeyAuth(allowed_routes=[], metadata={}, token="tok-direct-empty")
        omitted = UserAPIKeyAuth(allowed_routes=None, metadata={}, token="tok-direct-none")
        self.assertTrue(RouteChecks.should_call_route(route=APPLY, valid_token=bare))
        self.assertTrue(
            RouteChecks.is_virtual_key_allowed_to_call_route(route=CHAT, valid_token=omitted)
        )
        self.assertFalse(RouteChecks.check_route_access(route=APPLY, allowed_routes=[]))
        self.assertFalse(RouteChecks.check_route_access(route=CHAT, allowed_routes=[]))

        for secret, path in (
            (EMPTY, APPLY),
            (EMPTY, CHAT),
            (NONE_ROUTES, APPLY),
            (NONE_ROUTES, MESSAGES),
            (PERMS, APPLY),
        ):
            decision = await self._auth(secret, "POST" if path != MESSAGES else "POST", path)
            self.assertFalse(decision.allow, secret)
            self.assertEqual(decision.code, "scope_missing")
            self.assertEqual(decision.note, "empty-routes-fail-open")
            self.assertIn(_FN_SHOULD, decision.executed)
            self.assertIn(_FN_CHECK, decision.executed)
        perms = await self._auth(PERMS, "POST", APPLY)
        self.assertEqual(perms.principal["permissions"], {"apply": True})
        self.assertEqual(perms.principal["allowed_routes"], [])
        self.assertNoSecretLogs()

    async def test_path_prefix_tricks_do_not_escalate(self):
        trick = f"/jev/v1/projects/{PROJECT}/applied/../apply"
        self.assertTrue(
            RouteChecks._route_matches_allowed_route(route=trick, allowed_route=APPLIED)
        )
        self.assertIsNone(canonicalize(trick))
        denied = await self._auth(SCOPED, "POST", trick)
        self.assertFalse(denied.allow)
        self.assertEqual(denied.code, "malformed")
        self.assertNotIn(_FN_SHOULD, denied.executed)

        encoded = f"/jev/v1/projects/{PROJECT}/applied/%2e%2e/apply"
        double = f"/jev/v1/projects/{PROJECT}/applied/%252e%252e/apply"
        slash = f"/jev/v1/projects/{PROJECT}/applied%2f..%2fapply"
        for path in (encoded, double, slash, f"{APPLY}/../{OTHER_APPLY.lstrip('/')}", "//jev/v1", APPLY + "/"):
            decision = await self._auth(SCOPED, "POST", path)
            self.assertFalse(decision.allow, path)
            self.assertEqual(decision.code, "malformed", path)
            self.assertNotIn(_FN_SHOULD, decision.executed, path)

        for path in ("jev/v1/projects/x/apply", APPLY + " ", APPLY + "\n", APPLY.replace("/", "\\", 1)):
            decision = await self._auth(SCOPED, "POST", path)
            self.assertEqual(decision.code, "malformed", path)

        extra = APPLY + "/extra"
        self.assertTrue(RouteChecks._route_matches_allowed_route(route=extra, allowed_route=APPLY))
        extra_decision = await self._auth(SCOPED, "POST", extra)
        self.assertFalse(extra_decision.allow)
        self.assertEqual(extra_decision.code, "route_denied")
        self.assertEqual(extra_decision.note, "exact-shape")
        self.assertIn(_FN_SHOULD, extra_decision.executed)

        parent = f"/jev/v1/projects/{PROJECT}"
        self.assertTrue(RouteChecks._route_matches_allowed_route(route=APPLY, allowed_route=parent))
        self.assertTrue(RouteChecks._route_matches_allowed_route(route=APPLIED, allowed_route=parent))
        self.assertNotIn(parent, (await self._auth(SCOPED, "POST", APPLY)).principal["allowed_routes"])
        self.assertNoSecretLogs()

    async def test_logs_principal_and_permissions_never_raw_bearer(self):
        records = []

        class Capture(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage())

        handler = Capture()
        logger = logging.getLogger("jev.auth_b")
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        self.addCleanup(logger.removeHandler, handler)
        decision = await self._auth(SCOPED, "POST", APPLY)
        self.assertTrue(decision.allow)
        self.assertTrue(records)
        joined = "\n".join(records)
        self.assertIn("token_id=tok-scoped-orca", joined)
        self.assertIn(f"project_id={PROJECT}", joined)
        self.assertIn("permissions=", joined)
        self.assertIn("apply-and-read", joined)
        for secret in SECRETS:
            self.assertNotIn(secret, joined)
        self.assertNotIn("Bearer", joined)
        self.assertNoSecretLogs()

    async def test_native_route_denial_message(self):
        key = UserAPIKeyAuth(
            token="tok-infer-direct",
            allowed_routes=["llm_api_routes"],
            metadata={},
            blocked=False,
        )
        with self.assertRaises(HTTPException) as caught:
            RouteChecks.should_call_route(route=APPLY, valid_token=key)
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIn("Virtual key is not allowed to call this route", str(caught.exception.detail))
        self.assertNotIn(INFER, str(caught.exception.detail))


if __name__ == "__main__":
    unittest.main(verbosity=2)
