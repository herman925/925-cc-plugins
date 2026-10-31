"""In-memory stand-in for LiteLLM's combined_view key lookup.

Stores the SHA-256 from ``hash_token`` and a public token id. The raw
fixture secret is not kept on the row. ``MockAuthPrisma`` answers the
user, team, and project reads inside ``validate_resolved_virtual_key``.
Missing rows are ``None``. This is not a database, a Vault item, or a
dashboard key.
"""

from litellm.proxy._types import UserAPIKeyAuth, hash_token


class _QuietTable:
    async def find_unique(self, *args, **kwargs):
        return None

    def __getattr__(self, name):
        async def _method(*args, **kwargs):
            return None

        return _method


class _FaultTable:
    def __init__(self, message):
        self._message = message

    async def find_unique(self, *args, **kwargs):
        raise RuntimeError(self._message)

    def __getattr__(self, name):
        message = self._message

        async def _method(*args, **kwargs):
            raise RuntimeError(message)

        return _method


class MockAuthPrisma:
    """Duck-typed ``prisma_client`` for the native key validator.

    ``validate_resolved_virtual_key`` reads ``db.litellm_usertable``,
    ``db.litellm_teamtable``, and ``db.litellm_projecttable``. A missing row
    is the native not-found result. ``project_fault`` forces the project
    read to raise so an unexpected dependency error stays a denial.
    """

    def __init__(self, store):
        self._store = store
        self.db = self

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        if name == "litellm_projecttable" and self._store.project_fault:
            return _FaultTable(self._store.project_fault)
        return _QuietTable()


class MockKeyStore:
    def __init__(self):
        self._rows = {}
        self.project_fault = None
        self.lookup_fault = None
        self.prisma = MockAuthPrisma(self)

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
        expires=None,
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
            expires=expires,
        )
        return token_id

    async def get_data(self, *, token, table_name, **kwargs):
        if self.lookup_fault:
            raise RuntimeError(self.lookup_fault)
        if table_name != "combined_view":
            return None
        return self._rows.get(token)
