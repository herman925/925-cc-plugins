import { expect, test } from 'claude-code/testing'

import {
  checkSshPair,
  encodePs,
  errText,
  fileGet,
  filePut,
  fileRemove,
  folderProblem,
  fromB64,
  GET_PS,
  getKey,
  linuxGet,
  linuxProbe,
  linuxPut,
  linuxRemove,
  macGet,
  macPut,
  macRemove,
  osFrom,
  parseTagged,
  PIPE_PS,
  pipeName,
  pipeOutcome,
  pipePath,
  pipeReady,
  PUT_PS,
  putKey,
  REMOVE_PS,
  removeKey,
  resetVault,
  servePipe,
  servePipeCommand,
  serviceUp,
  sshPair,
  syncedFolder,
  toB64,
  useSshKey,
  validName,
  where,
  winGet,
  winKeyDir,
  winPut,
  winRemove,
} from './vault'

const SECRET = '{"Private":"privkey:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"}'
const B64 = toB64(SECRET)
const ok = (stdout: string, exitCode = 0, stderr = '') => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

// ── Pure builders ──

test('key names are plain: letters, digits, dot, dash, underscore; no path, no ..', () => {
  for (const n of ['device', 'home-pc', 'Lin_Mac.2', 'a']) expect(validName(n)).toBe(true)
  for (const n of ['', '.hidden', '../x', 'a/b', 'a\\b', 'a b', 'a..b', 'x'.repeat(65), 'k;rm', '$(x)']) expect(validName(n)).toBe(false)
  expect(() => winGet('C:/k', '../evil')).toThrow()
  expect(() => macPut('a b', SECRET)).toThrow()
})

test('base64 round-trips any text, and the PowerShell script encodes as UTF-16LE', () => {
  for (const s of [SECRET, 'héllo ✓ 鍵', '']) expect(fromB64(toB64(s))).toBe(s)
  expect(encodePs('ab')).toBe(btoa('a\0b\0'))
})

test('Windows: DPAPI through PowerShell, the secret on stdin only, the folder local and never roaming', () => {
  const dir = winKeyDir('C:\\Users\\me\\AppData\\Local')
  expect(dir).toBe('C:/Users/me/AppData/Local/team-orchestrator/keys')
  const put = winPut(dir, 'device', SECRET)
  expect(put.argv.slice(0, 4)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
  expect(put.argv[4]).toBe(encodePs(PUT_PS))
  expect(put.env).toEqual({ TO_KEY_DIR: dir, TO_KEY_NAME: 'device' })
  expect(put.stdin).toBe(B64)
  // the secret appears nowhere but stdin, in any form
  for (const c of [put, winGet(dir, 'device'), winRemove(dir, 'device')]) {
    const visible = JSON.stringify([c.argv, c.env])
    expect(visible).not.toContain('privkey')
    expect(visible).not.toContain(B64)
  }
  expect(PUT_PS).toContain('ConvertFrom-SecureString')
  expect(PUT_PS).toContain('[Console]::In.ReadToEnd()')
  expect(PUT_PS).toContain('/inheritance:r')
  // 5.1 has no ConvertFrom-SecureString -AsPlainText: both read through NetworkCredential
  expect(GET_PS).toContain("[Net.NetworkCredential]::new('',$s).Password")
  expect(GET_PS).not.toContain('-AsPlainText |')
  expect(REMOVE_PS).toContain('Remove-Item')
  expect(winPut(dir, 'device', SECRET, 'pwsh').argv[0]).toBe('pwsh')
  expect(folderProblem('C:/Users/me/AppData/Roaming/team-orchestrator/keys')).toContain('roaming')
  expect(folderProblem(dir)).toBe('')
})

test('Windows: the key is served once on an owner-only named pipe with a random name, never a file', () => {
  const name = pipeName(new Uint8Array(16).fill(0xab))
  expect(name).toBe(`to-key-${'ab'.repeat(16)}`)
  expect(pipePath(name)).toBe(`\\\\.\\pipe\\to-key-${'ab'.repeat(16)}`)
  const c = servePipeCommand('C:/k', 'device', name, 5000)
  expect(c.env).toEqual({ TO_KEY_DIR: 'C:/k', TO_KEY_NAME: 'device', TO_KEY_PIPE: name, TO_KEY_WAIT_MS: '5000' })
  expect(c.argv[4]).toBe(encodePs(PIPE_PS))
  expect(c.stdin).toBeUndefined()
  expect(() => servePipeCommand('C:/k', 'device', 'guessable')).toThrow()
  // both runtimes: .NET Framework's constructor, .NET's NamedPipeServerStreamAcl; one instance; the user alone
  expect(PIPE_PS).toContain('NamedPipeServerStreamAcl]::Create($n,')
  expect(PIPE_PS).toContain("New-Object IO.Pipes.NamedPipeServerStream($n,'Out',1,")
  expect(PIPE_PS).toContain('GetCurrent().User')
  expect(PIPE_PS).toContain('WaitForPipeDrain')
  expect(PIPE_PS).not.toMatch(/WriteAllText|Out-File|Set-Content/)
  expect(pipeReady(`READY|\\\\.\\pipe\\${name}\r\n`)).toBe(pipePath(name))
  expect(pipeReady('READY|\\\\.\\pipe\\other\r\n')).toBeUndefined()
  expect(pipeOutcome(`READY|x\r\nSERVED\r\n`, 0)).toBe('served')
  expect(pipeOutcome(`READY|x\r\nTIMEOUT\r\n`, 3)).toBe('timeout')
  expect(pipeOutcome('NONE\r\n', 0)).toBe('none')
  expect(pipeOutcome('', 1)).toBe('failed')
})

test('macOS: the Keychain through security, the secret in its stdin command, never in argv; no Touch ID', () => {
  const put = macPut('device', SECRET)
  expect(put.argv).toEqual(['security', '-i'])
  expect(put.stdin).toBe(`add-generic-password -U -a device -s team-orchestrator -w ${B64}\n`)
  expect(macGet('device').argv).toEqual(['security', 'find-generic-password', '-a', 'device', '-s', 'team-orchestrator', '-w'])
  expect(macRemove('device').argv).toEqual(['security', 'delete-generic-password', '-a', 'device', '-s', 'team-orchestrator'])
  // base64 is one token for security's own line parser: no space or quote to escape
  expect(/^[A-Za-z0-9+/=]+$/.test(B64)).toBe(true)
  expect(JSON.stringify(put.argv)).not.toContain(B64)
})

test('Linux: secret-tool with the secret on stdin; a silent miss means the Secret Service is up', () => {
  const put = linuxPut('device', SECRET)
  expect(put.argv).toEqual(['secret-tool', 'store', '--label=team-orchestrator device', 'service', 'team-orchestrator', 'key', 'device'])
  expect(put.stdin).toBe(B64)
  expect(linuxGet('device').argv).toEqual(['secret-tool', 'lookup', 'service', 'team-orchestrator', 'key', 'device'])
  expect(linuxRemove('device').argv).toEqual(['secret-tool', 'clear', 'service', 'team-orchestrator', 'key', 'device'])
  expect(linuxProbe().argv[1]).toBe('lookup')
  expect(serviceUp({ exitCode: 1, stdout: '', stderr: '' })).toBe(true)
  expect(serviceUp({ exitCode: 0, stdout: 'x', stderr: '' })).toBe(true)
  expect(serviceUp({ exitCode: 1, stdout: '', stderr: 'Cannot autolaunch D-Bus without X11 $DISPLAY' })).toBe(false)
  expect(serviceUp(undefined)).toBe(false)
})

test('the fallback file is 0600 in a 0700 folder, written whole, the secret on stdin', () => {
  const put = filePut('/home/lin/.config/team-orchestrator/keys', 'device', SECRET)
  expect(put.argv.slice(0, 2)).toEqual(['sh', '-c'])
  expect(put.argv[2]).toContain('umask 077')
  expect(put.argv[2]).toContain('chmod 700 -- "$1"')
  expect(put.argv[2]).toContain('chmod 600 -- "$2.tmp"')
  expect(put.argv.slice(3)).toEqual(['sh', '/home/lin/.config/team-orchestrator/keys', '/home/lin/.config/team-orchestrator/keys/device.key'])
  expect(put.stdin).toBe(B64)
  expect(fileGet('/k', 'device').argv.at(-1)).toBe('/k/device.key')
  expect(fileRemove('/k', 'device').argv[2]).toContain('rm -f')
})

test('the fallback refuses every synced folder: Google Drive (G:, My Drive), OneDrive, iCloud Drive, Dropbox, Box', () => {
  const synced: [string, string][] = [
    ['G:\\keys', 'Google Drive'],
    ['G:/My Drive/team-orchestrator/keys', 'Google Drive'],
    ['C:\\Users\\me\\Google Drive\\keys', 'Google Drive'],
    ['/Users/lin/Library/CloudStorage/GoogleDrive-lin@example.com/My Drive/keys', 'Google Drive'],
    ['C:\\Users\\me\\OneDrive\\keys', 'OneDrive'],
    ['C:\\Users\\me\\OneDrive - Contoso\\.config\\keys', 'OneDrive'],
    ['/Users/lin/Library/Mobile Documents/com~apple~CloudDocs/keys', 'iCloud Drive'],
    ['C:\\Users\\me\\iCloudDrive\\keys', 'iCloud Drive'],
    ['/home/lin/Dropbox/.config/team-orchestrator/keys', 'Dropbox'],
    ['/Users/lin/Dropbox (Personal)/keys', 'Dropbox'],
    ['C:\\Users\\me\\Box\\keys', 'Box'],
    ['/Users/lin/Library/CloudStorage/Box-Box/keys', 'Box'],
    ['/Users/lin/Library/CloudStorage/Nextcloud/keys', 'cloud drive'],
  ]
  for (const [p, service] of synced) {
    expect(syncedFolder(p)).toContain(service)
    expect(() => filePut(p, 'device', SECRET)).toThrow(service)
  }
  for (const p of ['/home/lin/.config/team-orchestrator/keys', '/Users/lin/.config/team-orchestrator/keys', 'C:/Users/me/AppData/Local/team-orchestrator/keys', 'D:/keys', '/home/lin/boxes/keys'])
    expect(syncedFolder(p)).toBeUndefined()
})

test('answers: tagged lines, PowerShell 5.1 CLIXML errors as words, the OS', () => {
  expect(parseTagged({ exitCode: 0, stdout: `KEY|${B64}\r\n`, stderr: '' })).toEqual({ kind: 'key', secret: SECRET })
  expect(parseTagged({ exitCode: 0, stdout: 'STORED\r\n', stderr: '' })).toEqual({ kind: 'stored' })
  expect(parseTagged({ exitCode: 0, stdout: 'NONE\n', stderr: '' })).toEqual({ kind: 'none' })
  expect(parseTagged({ exitCode: 1, stdout: 'STORED', stderr: '' })).toBeUndefined()
  expect(parseTagged({ exitCode: 0, stdout: 'KEY|not base64!', stderr: '' })).toBeUndefined()
  const clixml = '#< CLIXML\r\n<Objs><Obj S="progress"><AV>Preparing modules</AV></Obj><S S="Error">Key not valid for use in specified state._x000D__x000A_</S></Objs>'
  expect(errText(clixml)).toBe('Key not valid for use in specified state.')
  expect(osFrom('Windows_NT', '')).toBe('windows')
  expect(osFrom(undefined, 'Darwin\n')).toBe('macos')
  expect(osFrom(undefined, 'Linux\n')).toBe('linux')
})

// ── "Use my SSH key": synthetic OpenSSH files (public halves only; no real private key) ──

const u32 = (n: number) => String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
const sstr = (s: string) => u32(s.length) + s
const blobOf = (type: string, seed: number) => sstr(type) + sstr(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + seed) & 255))) + (type.startsWith('sk-') ? sstr('ssh:') : '')
const privOf = (blob: string, n = 1) =>
  `-----BEGIN OPENSSH PRIVATE KEY-----\n${btoa(`openssh-key-v1\0${sstr('aes256-ctr')}${sstr('bcrypt')}${sstr('salt')}${u32(n)}${sstr(blob)}${sstr('encrypted private part')}`).replace(/(.{70})/g, '$1\n')}\n-----END OPENSSH PRIVATE KEY-----\n`
const pubOf = (type: string, blob: string) => `${type} ${btoa(blob)} lin@mac\n`

test('an SSH key is used only as a matching ed25519 or ed25519-sk pair, checked without its passphrase', () => {
  for (const type of ['ssh-ed25519', 'sk-ssh-ed25519@openssh.com']) {
    const b = blobOf(type, 1)
    expect(checkSshPair(privOf(b), pubOf(type, b))).toEqual({ ok: true, type })
  }
  const b = blobOf('ssh-ed25519', 1)
  expect(checkSshPair(privOf(b), pubOf('ssh-ed25519', blobOf('ssh-ed25519', 2)))).toEqual({ ok: false, why: 'the public key does not belong to this private key' })
  const rsa = blobOf('ssh-rsa', 1)
  expect((checkSshPair(privOf(rsa), pubOf('ssh-rsa', rsa)) as any).why).toContain('only ed25519')
  expect((checkSshPair(privOf(rsa), pubOf('ssh-ed25519', rsa)) as any).why).toContain('ssh-rsa')
  expect((checkSshPair('-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----', pubOf('ssh-ed25519', b)) as any).why).toContain('not an OpenSSH')
  expect((checkSshPair(privOf(b, 2), pubOf('ssh-ed25519', b)) as any).why).toContain('more than one')
  // cut short inside the public key
  const cut = privOf(b).split('\n')
  expect(checkSshPair(`${cut[0]}\n${(cut[1] as string).slice(0, 40)}\n-----END OPENSSH PRIVATE KEY-----`, pubOf('ssh-ed25519', b)).ok).toBe(false)
  expect(sshPair('C:\\Users\\me\\.ssh\\id_ed25519.pub')).toEqual({ priv: 'C:/Users/me/.ssh/id_ed25519', pub: 'C:/Users/me/.ssh/id_ed25519.pub' })
  expect(sshPair('/home/lin/.ssh/id_ed25519_sk')).toEqual({ priv: '/home/lin/.ssh/id_ed25519_sk', pub: '/home/lin/.ssh/id_ed25519_sk.pub' })
})

// ── The wrappers through $, each OS faked ──

// A plugin-shaped $ (the kit's own $ is the engine's side): env, fs and process as the vault calls them.
type World = { env: Record<string, string>; files: Map<string, string>; calls: any[]; real?: (p: string) => string }
type Spawned = { chunks: { stream: 'stdout' | 'stderr'; text: string }[]; code: number }
function world(w: World, answer: (argv: string[], init: any) => any, spawn?: (req: any) => Spawned): any {
  resetVault()
  return {
    env: { get: async (name: string) => w.env[name] },
    fs: {
      exists: async (p: string) => w.files.has(p),
      read: async (p: string) => {
        if (!w.files.has(p)) throw new Error('ENOENT')
        return w.files.get(p)
      },
      write: async (p: string, text: string) => void w.files.set(p, text),
      stat: async (p: string) => ({ kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: w.real ? w.real(p) : p }),
    },
    process: {
      run: async (argv: string[], init: any = {}) => {
        w.calls.push({ argv, init })
        return answer(argv, init)
      },
      spawn: (req: any) => {
        w.calls.push({ argv: req.argv, init: req, spawn: true })
        const s = spawn ? spawn(req) : { chunks: [], code: 1 }
        return (async function* () {
          for (const c of s.chunks) yield c
          return { code: s.code, signal: null }
        })()
      },
    },
  }
}

test('Windows wrappers: put, get, remove through DPAPI; LOCALAPPDATA in OneDrive is refused', async () => {
  const w: World = { env: { OS: 'Windows_NT', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', USERPROFILE: 'C:\\Users\\me' }, files: new Map(), calls: [] }
  const vault = new Map<string, string>()
  const $ = world(w, (argv, init) => {
    const s = argv[4]
    const k = `${init.env.TO_KEY_DIR}|${init.env.TO_KEY_NAME}`
    if (s === encodePs(PUT_PS)) return (vault.set(k, init.stdin), ok('STORED\r\n'))
    if (s === encodePs(GET_PS)) return ok(vault.has(k) ? `KEY|${vault.get(k)}\r\n` : 'NONE\r\n')
    if (s === encodePs(REMOVE_PS)) return ok(vault.delete(k) ? 'REMOVED\r\n' : 'NONE\r\n')
    return ok('', 1, 'unexpected')
  })
  expect(await where($)).toEqual({ os: 'windows', route: 'dpapi', location: 'C:/Users/me/AppData/Local/team-orchestrator/keys' })
  expect((await putKey($, 'device', SECRET)).route).toBe('dpapi')
  expect(await getKey($, 'device')).toBe(SECRET)
  expect(await getKey($, 'other')).toBeUndefined()
  expect(await removeKey($, 'device')).toBe(true)
  expect(await removeKey($, 'device')).toBe(false)
  expect(await getKey($, 'device')).toBeUndefined()
  // nothing the engine logs as a command line carries the secret
  for (const c of w.calls) expect(JSON.stringify(c.argv) + JSON.stringify(c.init.env ?? {})).not.toContain(B64)
  await expect(putKey($, 'device', '')).rejects.toThrow('empty')
  await expect(putKey($, 'device', 'x'.repeat(9000))).rejects.toThrow('over')
  await expect(putKey($, 'device', SECRET, { route: 'file' })).rejects.toThrow('DPAPI')

  w.env.LOCALAPPDATA = 'C:\\Users\\me\\OneDrive\\AppData\\Local'
  resetVault()
  expect((await where($)).refused).toContain('OneDrive')
  await expect(putKey($, 'device', SECRET)).rejects.toThrow('OneDrive')
})

test('Windows: a DPAPI failure comes back as words, without the CLIXML wrapping', async () => {
  const w: World = { env: { OS: 'Windows_NT', LOCALAPPDATA: 'C:/L' }, files: new Map(), calls: [] }
  const $ = world(w, () => ok('', 1, '#< CLIXML\r\n<Objs><S S="Error">Key not valid for use in specified state._x000D__x000A_</S></Objs>'))
  await expect(getKey($, 'device')).rejects.toThrow('reading the key with DPAPI failed: Key not valid for use in specified state.')
})

test('Windows: servePipe resolves with the pipe once it exists, then reports it served', async () => {
  const w: World = { env: { OS: 'Windows_NT', LOCALAPPDATA: 'C:/L' }, files: new Map(), calls: [] }
  let seen: any
  const $ = world(
    w,
    () => ok('', 1),
    req => {
      seen = req
      return { chunks: [{ stream: 'stdout', text: `READY|\\\\.\\pipe\\${req.env.TO_KEY_PIPE}\r\n` }, { stream: 'stdout', text: 'SERVED\r\n' }], code: 0 }
    },
  )
  const h = await servePipe($, 'device', { waitMs: 4000 })
  expect(h.pipe).toBe(pipePath(seen.env.TO_KEY_PIPE))
  expect(seen.env.TO_KEY_PIPE).toMatch(/^to-key-[0-9a-f]{32}$/)
  expect(seen.env.TO_KEY_WAIT_MS).toBe('4000')
  expect(seen.argv[4]).toBe(encodePs(PIPE_PS))
  expect(seen.input).toBeUndefined()
  expect(await h.done).toBe('served')
  // two serves never share a pipe name
  const h2 = await servePipe($, 'device')
  expect(h2.pipe).not.toBe(h.pipe)
})

test('Windows: servePipe for a missing key rejects', async () => {
  const w: World = { env: { OS: 'Windows_NT', LOCALAPPDATA: 'C:/L' }, files: new Map(), calls: [] }
  const $ = world(w, () => ok('', 1), () => ({ chunks: [{ stream: 'stdout', text: 'NONE\r\n' }], code: 0 }))
  await expect(servePipe($, 'nokey')).rejects.toThrow('no key named nokey')
})

test('macOS wrappers: the Keychain, the write confirmed by reading it back; a pipe is refused', async () => {
  const w: World = { env: { HOME: '/Users/lin' }, files: new Map(), calls: [] }
  const chain = new Map<string, string>()
  const $ = world(w, (argv, init) => {
    if (argv[0] === 'uname') return ok('Darwin\n')
    if (argv[0] === 'security' && argv[1] === '-i') {
      const m = String(init.stdin).match(/^add-generic-password -U -a (\S+) -s team-orchestrator -w (\S+)\n$/)
      if (m) chain.set(m[1] as string, m[2] as string)
      return ok('')
    }
    if (argv[1] === 'find-generic-password') return chain.has(argv[3] as string) ? ok(`${chain.get(argv[3] as string)}\n`) : ok('', 44, 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.')
    if (argv[1] === 'delete-generic-password') return chain.delete(argv[3] as string) ? ok('') : ok('', 44, 'not found')
    if (argv[0] === 'sh') return ok('NONE\n')
    return ok('', 127, 'no such command')
  })
  expect((await where($)).route).toBe('keychain')
  await putKey($, 'device', SECRET)
  expect(chain.get('device')).toBe(B64)
  expect(await getKey($, 'device')).toBe(SECRET)
  expect(await removeKey($, 'device')).toBe(true)
  expect(await getKey($, 'device')).toBeUndefined()
  for (const c of w.calls) expect(JSON.stringify(c.argv)).not.toContain(B64)
  await expect(servePipe($, 'device')).rejects.toThrow('Windows only')
})

test('macOS: a locked Keychain that drops the write is reported, not taken as stored', async () => {
  const w: World = { env: { HOME: '/Users/lin' }, files: new Map(), calls: [] }
  const $ = world(w, argv => (argv[0] === 'uname' ? ok('Darwin\n') : argv[1] === '-i' ? ok('', 0, 'security: SecKeychainItemCreateFromContent: User interaction is not allowed.') : ok('', 44, '')))
  await expect(putKey($, 'device', SECRET)).rejects.toThrow('User interaction is not allowed')
})

test('Linux wrappers: the Secret Service when it answers', async () => {
  const w: World = { env: { HOME: '/home/lin' }, files: new Map(), calls: [] }
  const ss = new Map<string, string>()
  const $ = world(w, (argv, init) => {
    if (argv[0] === 'uname') return ok('Linux\n')
    if (argv[0] === 'secret-tool') {
      const name = argv.at(-1) as string
      if (argv[1] === 'store') return (ss.set(name, init.stdin), ok(''))
      if (argv[1] === 'lookup') return ss.has(name) ? ok(ss.get(name) as string) : ok('', 1, '')
      if (argv[1] === 'clear') return (ss.delete(name), ok(''))
    }
    if (argv[0] === 'sh') return ok('NONE\n')
    return ok('', 127, '')
  })
  expect((await where($)).route).toBe('secret-service')
  await putKey($, 'device', SECRET)
  expect(ss.get('device')).toBe(B64)
  expect(await getKey($, 'device')).toBe(SECRET)
  expect(await removeKey($, 'device')).toBe(true)
  expect(await removeKey($, 'device')).toBe(false)
})

test('Linux with no Secret Service: the owner-only file under ~/.config, and never a synced or linked-in folder', async () => {
  const w: World = { env: { HOME: '/home/lin' }, files: new Map(), calls: [] }
  const disk = new Map<string, string>()
  const $ = world(w, (argv, init) => {
    if (argv[0] === 'uname') return ok('Linux\n')
    if (argv[0] === 'secret-tool') return ok('', 1, 'Cannot autolaunch D-Bus without X11 $DISPLAY')
    if (argv[0] === 'sh') {
      const script = argv[2] as string
      if (script.includes('umask 077')) return (disk.set(argv[5] as string, init.stdin), ok('STORED\n'))
      const f = argv[4] as string
      if (script.includes('rm -f')) return ok(disk.delete(f) ? 'REMOVED\n' : 'NONE\n')
      return ok(disk.has(f) ? `KEY|${disk.get(f)}` : 'NONE\n')
    }
    return ok('', 127, '')
  })
  const at = await where($)
  expect(at).toEqual({ os: 'linux', route: 'file', location: '/home/lin/.config/team-orchestrator/keys' })
  await putKey($, 'device', SECRET)
  expect(disk.get('/home/lin/.config/team-orchestrator/keys/device.key')).toBe(B64)
  expect(await getKey($, 'device')).toBe(SECRET)
  expect(await removeKey($, 'device')).toBe(true)

  // XDG_CONFIG_HOME inside Dropbox: refused by its spelling
  w.env.XDG_CONFIG_HOME = '/home/lin/Dropbox/config'
  await expect(putKey($, 'device', SECRET)).rejects.toThrow('Dropbox')
  // ~/.config a link into OneDrive: refused by where it really lands
  delete w.env.XDG_CONFIG_HOME
  w.real = p => p.replace('/home/lin/.config', '/home/lin/OneDrive/config')
  await expect(putKey($, 'device', SECRET)).rejects.toThrow('OneDrive')
  expect(disk.size).toBe(0)
})

test('macOS can be told to use the fallback file (a locked keychain over SSH)', async () => {
  const w: World = { env: { HOME: '/Users/lin' }, files: new Map(), calls: [] }
  const $ = world(w, argv => (argv[0] === 'uname' ? ok('Darwin\n') : argv[0] === 'sh' ? ok('STORED\n') : ok('', 1, '')))
  const at = await putKey($, 'device', SECRET, { route: 'file' })
  expect(at).toEqual({ os: 'macos', route: 'file', location: '/Users/lin/.config/team-orchestrator/keys' })
})

test('useSshKey records a valid ed25519 pair beside the keys, and refuses anything else', async () => {
  const w: World = { env: { OS: 'Windows_NT', LOCALAPPDATA: 'C:/Users/me/AppData/Local', USERPROFILE: 'C:/Users/me' }, files: new Map(), calls: [] }
  const $ = world(w, () => ok('', 1))
  const b = blobOf('sk-ssh-ed25519@openssh.com', 3)
  w.files.set('C:/Users/me/.ssh/id_ed25519_sk', privOf(b))
  w.files.set('C:/Users/me/.ssh/id_ed25519_sk.pub', pubOf('sk-ssh-ed25519@openssh.com', b))
  const r = blobOf('ssh-rsa', 3)
  w.files.set('C:/Users/me/.ssh/id_rsa', privOf(r))
  w.files.set('C:/Users/me/.ssh/id_rsa.pub', pubOf('ssh-rsa', r))
  w.files.set('C:/Users/me/.ssh/lonely', privOf(b))

  expect(await useSshKey($, '~/.ssh/id_ed25519_sk.pub')).toBe('C:/Users/me/.ssh/id_ed25519_sk')
  const saved = JSON.parse(w.files.get('C:/Users/me/AppData/Local/team-orchestrator/vault.json') as string)
  expect(saved).toEqual({ sshKey: 'C:/Users/me/.ssh/id_ed25519_sk' })
  // the file holds a path only, never key material
  expect(w.files.get('C:/Users/me/AppData/Local/team-orchestrator/vault.json')).not.toContain('OPENSSH')
  resetVault()
  expect((await where($)).sshKey).toBe('C:/Users/me/.ssh/id_ed25519_sk')

  await expect(useSshKey($, '~/.ssh/id_rsa')).rejects.toThrow('only ed25519')
  await expect(useSshKey($, '~/.ssh/lonely')).rejects.toThrow('public half')
  await expect(useSshKey($, '~/.ssh/missing')).rejects.toThrow('cannot be read')
})
