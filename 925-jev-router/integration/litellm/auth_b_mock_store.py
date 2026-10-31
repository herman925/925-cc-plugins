"""In-memory stand-in for LiteLLM's combined_view key lookup.

Stores the SHA-256 from ``hash_token`` and a public token id. The raw
fixture secret is not kept on the row. This is not a database, a Vault
item, or a dashboard key.
"""

from litellm.proxy._types import UserAPIKeyAuth, hash_token


class MockKeyStore:
    def __init__(self):
        self._rows = {}

    def insert(
        self,
        raw_secret,
        *,
        token_id,
        user_id,
        project_id,
        team_id,
        allowed_routes,
        blocked=False,
        permissions=None,
    ):
        if not isinstance(raw_secret, str) or not raw_secret.startswith("sk-"):
            raise ValueError("mock store only accepts synthetic sk- fixtures")
        digest = hash_token(raw_secret)
        self._rows[digest] = UserAPIKeyAuth(
            token=token_id,
            user_id=user_id,
            project_id=project_id,
            team_id=team_id,
            allowed_routes=allowed_routes,
            blocked=blocked,
            permissions={} if permissions is None else permissions,
            metadata={},
            models=[],
        )
        return token_id

    async def get_data(self, *, token, table_name, **kwargs):
        if table_name != "combined_view":
            return None
        return self._rows.get(token)
