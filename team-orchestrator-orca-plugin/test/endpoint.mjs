// The native runtime endpoint a fixture binds, in the form this platform allows.
//
// The worker reads one of these from orca-runtime.json and connects to it: a Unix socket path on macOS and Linux, a
// named pipe on Windows. A Unix socket inside a temp folder is refused there (listen EACCES), and a pipe needs no
// cleanup and has no path-length limit.
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export function endpointFor(profile, name = 'runtime') {
  if (process.platform !== 'win32') return { kind: 'unix', endpoint: join(profile, `${name}.sock`) };
  // the profile's hash keeps parallel files from sharing one pipe name
  const tag = createHash('sha256').update(String(profile)).digest('hex').slice(0, 16);
  return { kind: 'named-pipe', endpoint: `\\\\.\\pipe\\orca-${tag}-${name}` };
}
