// This function is serialized into the inspected parent: keep it closure-free.
// Runtime prerequisites and identity only. Versions are validation history, not admission rules.
export function validateRuntime(runtime) {
  const reject = (code, message) => { throw Object.assign(new Error(message), { code }); };
  if (runtime.platform === 'win32') reject('platform_unverified', 'Windows build is unverified. Capture its package/runtime contract before enabling this compatibility layer.');
  const build = runtime.build;
  const commits = {
    '1.4.222': '9fdd90ffa7721e145f1353ad9fb9df2f70c31f43',
    '1.4.223': 'ff4a51c872e723d87ab141044814301ea5a78634'
  };
  commits['1.4.229'] = '37c314bcc96063c42c468e564df2c34bac8ef8a1';
  if (runtime.appName?.toLowerCase() !== 'orca') reject('runtime_identity_mismatch', 'The inspected process is not Orca.');
  if (runtime.platform !== 'darwin' || runtime.arch !== 'arm64') reject('platform_unverified', 'This operating system or architecture has no verified adapter yet.');
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(runtime.appVersion) || !runtime.electron || !runtime.node) reject('runtime_identity_mismatch', 'Orca runtime identity is incomplete.');
  // Official builds need not ship our local-build metadata. If present, it must describe this process.
  if (build && (build.version !== runtime.appVersion || build.platform !== runtime.platform || build.architecture !== runtime.arch))
    reject('runtime_identity_mismatch', 'Application metadata does not match the running Orca process.');
  if (!runtime.sqlite) reject('node_capability_missing', 'The parent runtime does not provide Node SQLite DatabaseSync.');
  return { verification: 'runtime-prerequisites', testedBuild: Object.hasOwn(commits,runtime.appVersion) && build?.commit === commits[runtime.appVersion], buildId: build?.buildId ?? null, electron: runtime.electron, node: runtime.node, sqlite: true, liveProviderVerified: false };
}
