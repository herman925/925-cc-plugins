// This function is serialized into the inspected parent: keep it closure-free.
// Pinned source contract + read-only package inspection, NOT live provider acceptance.
export function validateRuntime(runtime) {
  const reject = (code, message) => { throw Object.assign(new Error(message), { code }); };
  if (runtime.platform === 'win32') reject('platform_unverified', 'Windows build is unverified. Capture its package/runtime contract before enabling this compatibility layer.');
  const build = runtime.build;
  if (runtime.appName?.toLowerCase() !== 'orca' || runtime.platform !== 'darwin' || runtime.arch !== 'arm64' ||
      runtime.appVersion !== '1.4.222' || runtime.electron !== '43.7.5' || runtime.node !== '24.21.0' ||
      build?.version !== '1.4.222' || build?.commit !== '9fdd90ffa7721e145f1353ad9fb9df2f70c31f43' ||
      build?.buildId !== '1.4.222-9fdd90ffa7721e145f1353ad9fb9df2f70c31f43-arm64' ||
      build?.platform !== runtime.platform || build?.architecture !== runtime.arch) {
    reject('unsupported_build', 'Unsupported Orca build. Only macOS arm64 1.4.222 / 9fdd90f / Electron 43.7.5 / Node 24.21.0 has a pinned contract; revalidate before adding another build.');
  }
  if (!runtime.sqlite) reject('node_capability_missing', 'The parent runtime does not provide Node SQLite DatabaseSync.');
  return { verification: 'pinned-contract', buildId: build.buildId, electron: runtime.electron, node: runtime.node, sqlite: true, liveProviderVerified: false };
}
