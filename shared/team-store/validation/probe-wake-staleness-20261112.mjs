// Current regression entrypoint. The historical bug probe is preserved at
// commit 778d0c5; it deliberately described the old implementation's gaps.
// These tests use disposable native-host and SQLite fixtures, never real sends.
await import('../test/orca-wake.test.mjs');
await import('../test/mod-wake-store.test.mjs');
