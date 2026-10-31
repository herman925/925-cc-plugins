"""Auth B mock-key gate. LiteLLM 1.106.2 functions, in-memory key rows.

Synthetic fixtures only. Does not mint a key, read Vault, or call a gateway.
"""

import logging
import unittest
from datetime import datetime, timezone

from fastapi import HTTPException
from litellm.proxy._types import GenerateKeyRequest, LiteLLMKeyType, UserAPIKeyAuth
from litellm.proxy.auth.route_checks import RouteChecks
from litellm.proxy.management_endpoints.key_management_endpoints import handle_key_type

from auth_b_control import SYNTHETIC_VERIFIER, MockApplyBridge
from auth_b_gate import authorize, canonicalize, dispatch_control
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
EXPIRED = "sk-jev-authb-expired-not-a-real-key"
PARENT = "sk-jev-authb-parent-not-a-real-key"
WILD = "sk-jev-authb-wild-not-a-real-key"
BOUND = "sk-jev-authb-bound-not-a-real-key"
UNBOUND = "sk-jev-authb-unbound-not-a-real-key"
NOT_SK = "not-a-virtual-key"
PARENT_GRANT = f"/jev/v1/projects/{PROJECT}"
WILD_GRANT = f"/jev/v1/projects/{PROJECT}/*"

SECRETS = (
    SCOPED,
    INFER,
    READ,
    BLOCKED,
    MISSING_KEY,
    EMPTY,
    NONE_ROUTES,
    PERMS,
    EXPIRED,
    PARENT,
    WILD,
    BOUND,
    UNBOUND,
    NOT_SK,
    SYNTHETIC_VERIFIER,
)

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
        self.store.insert(
            EXPIRED,
            token_id="tok-expired-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=[APPLY, APPLIED, "llm_api_routes"],
            permissions={"jev": "apply-and-read"},
            expires=datetime(2000, 1, 1, tzinfo=timezone.utc),
        )
        self.store.insert(
            PARENT,
            token_id="tok-parent-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=[PARENT_GRANT, "llm_api_routes"],
        )
        self.store.insert(
            WILD,
            token_id="tok-wild-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=[WILD_GRANT],
        )
        self.store.insert(
            BOUND,
            token_id="tok-bound-orca",
            user_id="user-orca",
            project_id=PROJECT,
            team_id="team-orca",
            allowed_routes=[OTHER_APPLY],
        )
        self.store.insert(
            UNBOUND,
            token_id="tok-unbound-orca",
            user_id="user-orca",
            project_id=None,
            team_id="team-orca",
            allowed_routes=[APPLY],
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

    async def test_expired_key_is_denied_before_route_checks(self):
        decision = await self._auth(EXPIRED, "POST", APPLY)
        self.assertFalse(decision.allow)
        self.assertEqual(decision.code, "expired")
        self.assertEqual(decision.note, "expired-key")
        self.assertEqual(decision.principal["token_id"], "tok-expired-orca")
        self.assertIn(_FN_VALIDATE, decision.executed)
        self.assertNotIn(_FN_SHOULD, decision.executed)
        self.assertNoSecretLogs()

    async def test_unexpected_validator_error_fails_closed(self):
        self.store.project_fault = "sentinel-unexpected-db"
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
        self.assertFalse(decision.allow)
        self.assertEqual(decision.code, "rejected")
        self.assertEqual(decision.note, "unexpected-error")
        self.assertIn(_FN_VALIDATE, decision.executed)
        self.assertNotIn(_FN_SHOULD, decision.executed)
        self.assertNotIn("sentinel-unexpected-db", "\n".join(records))
        self.assertNoSecretLogs()

    async def test_parent_and_wildcard_grants_do_not_permit_apply(self):
        self.assertTrue(
            RouteChecks._route_matches_allowed_route(route=APPLY, allowed_route=PARENT_GRANT)
        )
        parent = await self._auth(PARENT, "POST", APPLY)
        self.assertFalse(parent.allow)
        self.assertEqual(parent.code, "route_denied")
        self.assertEqual(parent.note, "exact-grant")
        self.assertIn(_FN_SHOULD, parent.executed)
        self.assertIn(_FN_CHECK, parent.executed)
        wild = await self._auth(WILD, "POST", APPLY)
        self.assertFalse(wild.allow)
        self.assertEqual(wild.note, "exact-grant")
        self.assertIn(_FN_CHECK, wild.executed)
        chat = await self._auth(PARENT, "POST", CHAT)
        self.assertTrue(chat.allow)
        self.assertNoSecretLogs()

    async def test_project_binding_rejects_other_project_grant(self):
        other = await self._auth(BOUND, "POST", OTHER_APPLY)
        self.assertFalse(other.allow)
        self.assertEqual(other.code, "route_denied")
        self.assertEqual(other.note, "project-binding")
        self.assertEqual(other.principal["project_id"], PROJECT)
        self.assertIn(OTHER_APPLY, other.principal["allowed_routes"])
        self.assertIn(_FN_SHOULD, other.executed)
        self.assertIn(_FN_CHECK, other.executed)
        missing = await self._auth(UNBOUND, "POST", APPLY)
        self.assertFalse(missing.allow)
        self.assertEqual(missing.note, "project-binding")
        self.assertIsNone(missing.principal["project_id"])
        own = await self._auth(SCOPED, "POST", APPLY)
        self.assertTrue(own.allow)
        self.assertEqual(own.principal["project_id"], PROJECT)
        self.assertNoSecretLogs()

    async def test_dispatch_mutates_only_after_allow(self):
        policy = {
            "schema_version": 1,
            "project_id": PROJECT,
            "candidates": ["cheap-worker", "strong-worker"],
            "fallback": "strong-worker",
            "default_worker_mode": "routed",
        }
        bridge = MockApplyBridge()
        self.addCleanup(bridge.close)

        async def denied(secret, method, path):
            before = bridge.calls
            decision, invoked, response = await dispatch_control(
                self.store, f"Bearer {secret}", method, path, bridge, policy
            )
            self.assertFalse(decision.allow)
            self.assertFalse(invoked)
            self.assertIsNone(response)
            self.assertEqual(bridge.calls, before)

        await denied(EXPIRED, "POST", APPLY)
        await denied(PARENT, "POST", APPLY)
        await denied(BOUND, "POST", OTHER_APPLY)
        await denied(INFER, "POST", APPLY)
        self.assertEqual(bridge.calls, 0)

        empty_decision, empty_invoked, empty = await dispatch_control(
            self.store, f"Bearer {SCOPED}", "GET", APPLIED, bridge
        )
        self.assertTrue(empty_decision.allow)
        self.assertTrue(empty_invoked)
        self.assertEqual(empty["status"], 404)
        self.assertEqual(bridge.calls, 1)

        first_decision, first_invoked, first = await dispatch_control(
            self.store, f"Bearer {SCOPED}", "POST", APPLY, bridge, policy
        )
        self.assertTrue(first_decision.allow)
        self.assertTrue(first_invoked)
        self.assertEqual(first["status"], 200)
        self.assertEqual(first["body"]["revision"], 1)
        self.assertEqual(first["body"]["project_id"], PROJECT)
        self.assertEqual(bridge.calls, 2)

        read_decision, read_invoked, read = await dispatch_control(
            self.store, f"Bearer {SCOPED}", "GET", APPLIED, bridge
        )
        self.assertTrue(read_decision.allow)
        self.assertTrue(read_invoked)
        self.assertEqual(read["status"], 200)
        self.assertEqual(read["body"]["revision"], 1)
        self.assertEqual(bridge.calls, 3)

        await denied(EXPIRED, "POST", APPLY)
        await denied(INFER, "GET", APPLIED)
        still_decision, still_invoked, still = await dispatch_control(
            self.store, f"Bearer {SCOPED}", "GET", APPLIED, bridge
        )
        self.assertTrue(still_decision.allow)
        self.assertTrue(still_invoked)
        self.assertEqual(still["body"]["revision"], 1)
        self.assertEqual(bridge.calls, 4)

        second_decision, second_invoked, second = await dispatch_control(
            self.store, f"Bearer {SCOPED}", "POST", APPLY, bridge, policy
        )
        self.assertTrue(second_decision.allow)
        self.assertTrue(second_invoked)
        self.assertEqual(second["status"], 200)
        self.assertEqual(second["body"]["revision"], 2)
        self.assertEqual(bridge.calls, 5)
        self.assertNoSecretLogs()


if __name__ == "__main__":
    unittest.main(verbosity=2)
