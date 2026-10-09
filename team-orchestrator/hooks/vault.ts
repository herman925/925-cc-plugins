// Device keys in each computer's own vault (#79). Each device keeps its own key where its OS keeps secrets:
//  - Windows: DPAPI (ConvertFrom-SecureString), a per-user blob in %LOCALAPPDATA%\team-orchestrator\keys (LOCAL, never
//    the roaming %APPDATA%), handed to Tailcat on a one-shot named pipe so the plain key never touches the disk.
//  - macOS: the login Keychain through `security` (no Touch ID: the CLI cannot ask for it).
//  - Linux: the Secret Service through `secret-tool`.
//  - Otherwise: an owner-only file (0600 in a 0700 folder) under ~/.config/team-orchestrator/keys, never in a synced folder.
// The secret never sits on a command line: it goes in on stdin and comes back on stdout. Every route stores the
// secret's base64 (UTF-8), so no shell, tokenizer or console code page ever sees a quote, a space or a non-ASCII byte.
// Pure builders and parsers first (a test fakes each OS), then thin wrappers that run them through $.

import { keepPath } from './platform'

export type Os = 'windows' | 'macos' | 'linux'
export type Route = 'dpapi' | 'keychain' | 'secret-service' | 'file'
/** One command: no shell, the secret (when any) in stdin, paths and names in env or argv. */
export type Cmd = { argv: string[]; env?: Record<string, string>; stdin?: string }
/** Where keys go on this device, and the folder or store that holds them. */
export type Where = { os: Os; route: Route; location: string; refused?: string; sshKey?: string }

/** The Keychain service and Secret Service attribute every key is filed under. */
export const SERVICE = 'team-orchestrator'
/** The longest secret the vault takes (a Tailcat key file is ~200 bytes; a Windows credential tops out at 2,560). */
export const MAX_SECRET = 8192
/** How long a served pipe waits for its one reader. */
export const PIPE_WAIT_MS = 30000

/** Key names: a letter or digit, then letters, digits, dot, dash or underscore; at most 64. */
export const validName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) && !name.includes('..')
function mustName(name: string) {
  if (!validName(name)) throw new Error(`"${name}" is not a key name: use letters, digits, dot, dash or underscore (at most 64)`)
}

// ── base64, with only atob/btoa (no Node Buffer in the mod) ──

export function toB64(text: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin)
}
export function fromB64(b64: string): string {
  const bin = atob(b64.trim())
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}
const isB64 = (s: string) => /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 === 0

/** PowerShell's -EncodedCommand: the script as UTF-16LE, base64. */
export function encodePs(script: string): string {
  let bin = ''
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i)
    bin += String.fromCharCode(c & 0xff, c >> 8)
  }
  return btoa(bin)
}

// ── Synced folders: the fallback file (and the Windows key folder) must never sit in one ──

/**
 * The sync service a path sits in, or undefined. Google Drive (G:\, "My Drive", "Google Drive", DriveFS, macOS
 * CloudStorage/GoogleDrive-…), OneDrive, iCloud Drive (Mobile Documents, com~apple~CloudDocs), Dropbox, Box, and
 * anything else under macOS ~/Library/CloudStorage. Matching is by folder name, so it errs towards refusing.
 */
export function syncedFolder(path: string): string | undefined {
  const p = keepPath(path).toLowerCase()
  if (/^g:(\/|$)/.test(p)) return 'Google Drive (G:)'
  const segs = p.split('/')
  for (const s of segs) {
    if (s === 'my drive' || s === 'google drive' || s === 'googledrive' || s.startsWith('googledrive-') || s === 'drivefs') return 'Google Drive'
    if (s.startsWith('onedrive')) return 'OneDrive'
    if (s === 'icloud drive' || s === 'iclouddrive' || s === 'mobile documents' || s === 'com~apple~clouddocs') return 'iCloud Drive'
    if (s.startsWith('dropbox')) return 'Dropbox'
    if (s === 'box' || s === 'box sync' || s.startsWith('box-')) return 'Box'
  }
  if (/\/library\/cloudstorage(\/|$)/.test(p)) return 'a cloud drive (Library/CloudStorage)'
  return undefined
}

/** Why keys may not be kept in this folder, or '' when they may: synced, or the roaming Windows profile. */
export function folderProblem(dir: string): string {
  const s = syncedFolder(dir)
  if (s) return `${keepPath(dir)} is inside ${s}, which copies files to other computers; a device key must stay on this one`
  if (/\/appdata\/roaming(\/|$)/i.test(keepPath(dir))) return `${keepPath(dir)} is in the roaming Windows profile, which follows the account to other computers`
  return ''
}

// ── Where keys go ──

/** The OS from the OS variable (Windows_NT on Windows) and `uname -s` elsewhere. */
export const osFrom = (osVar: string | undefined, uname: string): Os =>
  osVar === 'Windows_NT' ? 'windows' : /darwin/i.test(uname) ? 'macos' : 'linux'

/** The Windows key folder: %LOCALAPPDATA%\team-orchestrator\keys. */
export const winKeyDir = (localAppData: string) => `${keepPath(localAppData)}/team-orchestrator/keys`
/** The fallback key folder: $XDG_CONFIG_HOME (else ~/.config)/team-orchestrator/keys. */
export const fileKeyDir = (home: string, xdg?: string) => `${keepPath(xdg || `${keepPath(home)}/.config`)}/team-orchestrator/keys`
/** The small, non-secret settings file next to the keys (the SSH key path). */
export const settingsFile = (keyDir: string) => `${keyDir.replace(/\/keys$/, '')}/vault.json`

// ── Windows: DPAPI through PowerShell. The scripts take TO_KEY_DIR and TO_KEY_NAME from env, the secret from stdin. ──
// Each runs unchanged in Windows PowerShell 5.1 and PowerShell 7.

const PS_FILE = String.raw`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $d=$env:TO_KEY_DIR; $f=Join-Path $d ($env:TO_KEY_NAME+'.dpapi')`
const PS_READ = String.raw`$s=ConvertTo-SecureString ([IO.File]::ReadAllText($f).Trim()); $v=[Net.NetworkCredential]::new('',$s).Password`

export const PUT_PS = String.raw`${PS_FILE}
$v=[Console]::In.ReadToEnd().Trim(); $null=[Convert]::FromBase64String($v)
$null=New-Item -ItemType Directory -Force -Path $d
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$null=& icacls.exe $d /inheritance:r /grant:r ('*'+$sid+':(OI)(CI)F'); if($LASTEXITCODE -ne 0){throw 'icacls could not make the key folder owner-only'}
$blob=ConvertTo-SecureString $v -AsPlainText -Force | ConvertFrom-SecureString; $v=$null
[IO.File]::WriteAllText($f+'.tmp',$blob)
if(Test-Path -LiteralPath $f){Remove-Item -LiteralPath $f -Force}
Move-Item -LiteralPath ($f+'.tmp') -Destination $f
'STORED'`

export const GET_PS = String.raw`${PS_FILE}
if(-not (Test-Path -LiteralPath $f)){'NONE'; exit 0}
${PS_READ}
'KEY|'+$v`

export const REMOVE_PS = String.raw`${PS_FILE}
if(-not (Test-Path -LiteralPath $f)){'NONE'; exit 0}
Remove-Item -LiteralPath $f -Force
'REMOVED'`

// Serves the key once on \\.\pipe\<TO_KEY_PIPE>, readable by this user alone, then closes it. READY goes out (flushed)
// only once the pipe exists, so the reader is started after it; TIMEOUT when nobody reads within TO_KEY_WAIT_MS.
export const PIPE_PS = String.raw`${PS_FILE}
if(-not (Test-Path -LiteralPath $f)){'NONE'; exit 0}
${PS_READ}
$b=[Convert]::FromBase64String($v); $v=$null
$sec=New-Object IO.Pipes.PipeSecurity
$sec.AddAccessRule((New-Object IO.Pipes.PipeAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','Allow')))
$n=$env:TO_KEY_PIPE
if($PSVersionTable.PSEdition -eq 'Core'){$p=[IO.Pipes.NamedPipeServerStreamAcl]::Create($n,'Out',1,'Byte','Asynchronous',0,0,$sec)}
else{$p=New-Object IO.Pipes.NamedPipeServerStream($n,'Out',1,'Byte','Asynchronous',0,0,$sec)}
try{
  [Console]::Out.WriteLine('READY|\\.\pipe\'+$n); [Console]::Out.Flush()
  $t=$p.WaitForConnectionAsync()
  if(-not $t.Wait([int]$env:TO_KEY_WAIT_MS)){'TIMEOUT'; exit 3}
  $p.Write($b,0,$b.Length); $p.Flush(); $p.WaitForPipeDrain()
  'SERVED'
} finally { [Array]::Clear($b,0,$b.Length); $p.Dispose() }`

/** powershell.exe (5.1, always there) unless told otherwise; pwsh runs the same scripts. */
const psArgv = (script: string, shell = 'powershell.exe') => [shell, '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(script)]

export const winPut = (dir: string, name: string, secret: string, shell?: string): Cmd => {
  mustName(name)
  return { argv: psArgv(PUT_PS, shell), env: { TO_KEY_DIR: dir, TO_KEY_NAME: name }, stdin: toB64(secret) }
}
export const winGet = (dir: string, name: string, shell?: string): Cmd => (mustName(name), { argv: psArgv(GET_PS, shell), env: { TO_KEY_DIR: dir, TO_KEY_NAME: name } })
export const winRemove = (dir: string, name: string, shell?: string): Cmd => (mustName(name), { argv: psArgv(REMOVE_PS, shell), env: { TO_KEY_DIR: dir, TO_KEY_NAME: name } })

/** A pipe name nobody can guess: to-key- and 32 hex digits from `bytes` (16 random bytes). */
export const pipeName = (bytes: Uint8Array) => `to-key-${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`
/** The full pipe path Tailcat takes as --key=. */
export const pipePath = (name: string) => `\\\\.\\pipe\\${name}`

/** The command that serves the key `name` once on the pipe `pipe` (a pipeName), for `tailcat --key=<pipePath(pipe)>`. */
export function servePipeCommand(dir: string, name: string, pipe: string, waitMs = PIPE_WAIT_MS, shell?: string): Cmd {
  mustName(name)
  if (!/^to-key-[0-9a-f]{32}$/.test(pipe)) throw new Error('the pipe name must come from pipeName')
  return { argv: psArgv(PIPE_PS, shell), env: { TO_KEY_DIR: dir, TO_KEY_NAME: name, TO_KEY_PIPE: pipe, TO_KEY_WAIT_MS: String(Math.max(1000, Math.floor(waitMs))) } }
}

// ── macOS: the login Keychain. `security -i` reads its command from stdin, so the secret is never in argv and no
// password prompt opens (`-w` last would prompt on the terminal). The value is base64: one token, nothing to quote. ──

export const macPut = (name: string, secret: string): Cmd => {
  mustName(name)
  return { argv: ['security', '-i'], stdin: `add-generic-password -U -a ${name} -s ${SERVICE} -w ${toB64(secret)}\n` }
}
export const macGet = (name: string): Cmd => (mustName(name), { argv: ['security', 'find-generic-password', '-a', name, '-s', SERVICE, '-w'] })
export const macRemove = (name: string): Cmd => (mustName(name), { argv: ['security', 'delete-generic-password', '-a', name, '-s', SERVICE] })

// ── Linux: the Secret Service. secret-tool reads the secret from stdin when stdin is not a terminal. ──

export const linuxPut = (name: string, secret: string): Cmd => {
  mustName(name)
  return { argv: ['secret-tool', 'store', `--label=${SERVICE} ${name}`, 'service', SERVICE, 'key', name], stdin: toB64(secret) }
}
export const linuxGet = (name: string): Cmd => (mustName(name), { argv: ['secret-tool', 'lookup', 'service', SERVICE, 'key', name] })
export const linuxRemove = (name: string): Cmd => (mustName(name), { argv: ['secret-tool', 'clear', 'service', SERVICE, 'key', name] })
/** A lookup that finds nothing: exit 1 and silence when the Secret Service answers; an error on stderr when it does not. */
export const linuxProbe = (): Cmd => ({ argv: ['secret-tool', 'lookup', 'service', SERVICE, 'key', '.probe'] })
export const serviceUp = (r: Ran | undefined) => !!r && (r.exitCode === 0 || (r.exitCode === 1 && r.stderr.trim() === ''))

// ── The fallback file, macOS and Linux: umask 077, the folder 0700, the file 0600, written whole then moved in. ──

const FILE_PUT = 'umask 077 && mkdir -p -- "$1" && chmod 700 -- "$1" && cat > "$2.tmp" && chmod 600 -- "$2.tmp" && mv -f -- "$2.tmp" "$2" && echo STORED'
const FILE_GET = '[ -f "$1" ] || { echo NONE; exit 0; }; printf "KEY|"; cat -- "$1"'
const FILE_REMOVE = '[ -f "$1" ] || { echo NONE; exit 0; }; rm -f -- "$1" && echo REMOVED'
const keyFile = (dir: string, name: string) => `${dir}/${name}.key`

export function filePut(dir: string, name: string, secret: string): Cmd {
  mustName(name)
  const why = folderProblem(dir)
  if (why) throw new Error(why)
  return { argv: ['sh', '-c', FILE_PUT, 'sh', dir, keyFile(dir, name)], stdin: toB64(secret) }
}
export const fileGet = (dir: string, name: string): Cmd => (mustName(name), { argv: ['sh', '-c', FILE_GET, 'sh', keyFile(dir, name)] })
export const fileRemove = (dir: string, name: string): Cmd => (mustName(name), { argv: ['sh', '-c', FILE_REMOVE, 'sh', keyFile(dir, name)] })

// ── Reading the answers ──

export type Ran = { exitCode: number; stdout: string; stderr: string }
/** A short, single-line reason from a failed run (never the stdin, which is where a secret goes). */
export const why = (r: Ran | undefined, what: string) =>
  `${what} failed: ${String(r ? errText(r.stderr) || r.stdout || `exit ${r.exitCode}` : 'it did not start').replace(/\s+/g, ' ').trim().slice(0, 200)}`

/** stderr as words: Windows PowerShell 5.1 wraps it in CLIXML (progress records and all) when stdout is not a console. */
export function errText(stderr: string): string {
  if (!stderr.startsWith('#< CLIXML')) return stderr
  return [...stderr.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
    .map(m => (m[1] as string).replace(/_x000D_|_x000A_/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
    .join(' ')
    .trim()
}

/** The PowerShell and fallback-file answers: STORED / REMOVED / NONE / KEY|<base64>. */
export function parseTagged(r: Ran | undefined): { kind: 'stored' | 'removed' | 'none' } | { kind: 'key'; secret: string } | undefined {
  if (!r || r.exitCode !== 0) return undefined
  const lines = r.stdout.split(/\r?\n/).map(l => l.trim())
  const key = lines.find(l => l.startsWith('KEY|'))
  if (key !== undefined) {
    const b64 = key.slice(4)
    return isB64(b64) ? { kind: 'key', secret: fromB64(b64) } : undefined
  }
  if (lines.includes('STORED')) return { kind: 'stored' }
  if (lines.includes('REMOVED')) return { kind: 'removed' }
  if (lines.includes('NONE')) return { kind: 'none' }
  return undefined
}

/** The pipe path once PIPE_PS has made the pipe, from what it has written so far. */
export const pipeReady = (out: string) => out.match(/^READY\|(\\\\\.\\pipe\\to-key-[0-9a-f]{32})\s*$/m)?.[1]
/** How a served pipe ended: served (read once), timeout (nobody read), none (no such key), or failed. */
export const pipeOutcome = (out: string, code: number | null): 'served' | 'timeout' | 'none' | 'failed' =>
  /^SERVED\s*$/m.test(out) && code === 0 ? 'served' : /^TIMEOUT\s*$/m.test(out) ? 'timeout' : /^NONE\s*$/m.test(out) ? 'none' : 'failed'

// ── "Use my SSH key" (#84 builds the use): an ed25519 or ed25519-sk pair, checked by its public halves ──

export const SSH_TYPES = ['ssh-ed25519', 'sk-ssh-ed25519@openssh.com']

/** SSH wire format over a binary string: big-endian uint32s and length-prefixed strings; throws when cut short. */
function sshReader(bin: string, start: number) {
  let at = start
  const u32 = () => {
    if (at + 4 > bin.length) throw new Error('short')
    const n = ((bin.charCodeAt(at) << 24) | (bin.charCodeAt(at + 1) << 16) | (bin.charCodeAt(at + 2) << 8) | bin.charCodeAt(at + 3)) >>> 0
    at += 4
    return n
  }
  const str = () => {
    const n = u32()
    if (at + n > bin.length) throw new Error('short')
    at += n
    return bin.slice(at - n, at)
  }
  return { u32, str }
}

/** Both file paths of an SSH key pair, from either one. */
export const sshPair = (path: string) => {
  const p = keepPath(path)
  const priv = p.endsWith('.pub') ? p.slice(0, -4) : p
  return { priv, pub: `${priv}.pub` }
}

/**
 * Whether the two files are one ed25519 or ed25519-sk pair: the .pub line's type and key, and the public key the
 * OpenSSH private-key file carries in clear before its (possibly encrypted) private part, must match. The private
 * part is never decoded, so a passphrase is never needed.
 */
export function checkSshPair(privText: string, pubText: string): { ok: true; type: string } | { ok: false; why: string } {
  const [type, body] = pubText.trim().split(/\s+/)
  if (!type || !body || !SSH_TYPES.includes(type)) return { ok: false, why: `the public key is ${type ? `a ${type} key` : 'empty'}; only ed25519 and ed25519-sk keys are used` }
  const m = privText.match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/)
  if (!m) return { ok: false, why: 'the private key is not an OpenSSH private key file' }
  let bin: string, pubBin: string
  try {
    bin = atob((m[1] as string).replace(/\s+/g, ''))
    pubBin = atob(body)
  } catch {
    return { ok: false, why: 'a key file is not valid base64' }
  }
  const MAGIC = 'openssh-key-v1\0'
  if (!bin.startsWith(MAGIC)) return { ok: false, why: 'the private key is not an OpenSSH v1 key' }
  try {
    const priv = sshReader(bin, MAGIC.length)
    priv.str() // cipher
    priv.str() // kdf
    priv.str() // kdf options
    if (priv.u32() !== 1) return { ok: false, why: 'the private key file holds more than one key' }
    const blob = priv.str()
    const inner = sshReader(blob, 0).str()
    if (inner !== type) return { ok: false, why: `the private key is a ${inner} key but the public key is ${type}` }
    if (blob !== pubBin) return { ok: false, why: 'the public key does not belong to this private key' }
  } catch {
    return { ok: false, why: 'the private key file is cut short' }
  }
  return { ok: true, type }
}

// ── The wrappers: run the commands through $ ──

const none = () => undefined
const local = { os: undefined as Os | undefined }

async function osOf($: any): Promise<Os> {
  if (local.os) return local.os
  const osVar = await $.env.get('OS').catch(none)
  if (osVar === 'Windows_NT') return (local.os = 'windows')
  const r = await $.process.run(['uname', '-s'], { timeoutMs: 10000 }).catch(none)
  return (local.os = osFrom(osVar, String(r?.stdout ?? '')))
}

const run = ($: any, c: Cmd, timeoutMs = 20000): Promise<Ran | undefined> =>
  $.process.run(c.argv, { ...(c.env ? { env: c.env } : {}), ...(c.stdin !== undefined ? { stdin: c.stdin } : {}), timeoutMs }).catch(none)

async function homeOf($: any): Promise<string> {
  return String((await $.env.get('USERPROFILE').catch(none)) || (await $.env.get('HOME').catch(none)) || '')
}

async function winDir($: any): Promise<string> {
  const lad = String((await $.env.get('LOCALAPPDATA').catch(none)) ?? '')
  if (!lad) throw new Error('LOCALAPPDATA is not set, so there is no local (non-roaming) folder for device keys')
  return winKeyDir(lad)
}
async function fileDir($: any): Promise<string> {
  const home = await homeOf($)
  if (!home) throw new Error('HOME is not set, so there is no folder for the device key file')
  return fileKeyDir(home, String((await $.env.get('XDG_CONFIG_HOME').catch(none)) ?? ''))
}

/** folderProblem on the folder as spelled and as it really lands (a link into Dropbox counts as Dropbox). */
async function realFolderProblem($: any, dir: string): Promise<string> {
  const spelled = folderProblem(dir)
  if (spelled) return spelled
  // the nearest folder that exists, resolved
  let at = keepPath(dir)
  for (let i = 0; i < 32 && at !== ''; i++) {
    const st = await $.fs.stat(at, { resolve: true }).catch(none)
    if (st?.realPath) {
      const real = folderProblem(String(st.realPath))
      return real ? `${keepPath(dir)} leads into a synced folder: ${real}` : ''
    }
    const cut = at.lastIndexOf('/')
    if (cut <= 0) break
    at = at.slice(0, cut)
  }
  return ''
}

/** Which route this device uses, and where; `refused` says why keys cannot be kept there. `file` forces the fallback. */
export async function where($: any, opts: { route?: 'file' } = {}): Promise<Where> {
  const os = await osOf($)
  const sshKey = await readSshKey($, os)
  const extra = sshKey ? { sshKey } : {}
  if (os === 'windows') {
    if (opts.route === 'file') return { os, route: 'file', location: '', refused: 'on Windows device keys go through DPAPI, not a plain file', ...extra }
    const dir = await winDir($).catch((e: Error) => e)
    if (dir instanceof Error) return { os, route: 'dpapi', location: '', refused: dir.message, ...extra }
    const refused = await realFolderProblem($, dir)
    return { os, route: 'dpapi', location: dir, ...(refused ? { refused } : {}), ...extra }
  }
  if (opts.route !== 'file') {
    if (os === 'macos') return { os, route: 'keychain', location: `login keychain, service ${SERVICE}`, ...extra }
    if (serviceUp(await run($, linuxProbe(), 15000))) return { os, route: 'secret-service', location: `Secret Service, service=${SERVICE}`, ...extra }
  }
  const dir = await fileDir($).catch((e: Error) => e)
  if (dir instanceof Error) return { os, route: 'file', location: '', refused: dir.message, ...extra }
  const refused = await realFolderProblem($, dir)
  return { os, route: 'file', location: dir, ...(refused ? { refused } : {}), ...extra }
}

/** Stores the key (replacing one of the same name) and resolves where it went; rejects with the reason. */
export async function putKey($: any, name: string, secret: string, opts: { route?: 'file' } = {}): Promise<Where> {
  mustName(name)
  if (typeof secret !== 'string' || secret === '') throw new Error('the secret is empty')
  if (new TextEncoder().encode(secret).length > MAX_SECRET) throw new Error(`the secret is over ${MAX_SECRET} bytes`)
  const w = await where($, opts)
  if (w.refused) throw new Error(w.refused)
  if (w.route === 'dpapi') {
    const r = await run($, winPut(w.location, name, secret))
    if (parseTagged(r)?.kind !== 'stored') throw new Error(why(r, 'storing the key with DPAPI'))
  } else if (w.route === 'keychain') {
    const r = await run($, macPut(name, secret))
    // security -i answers 0 whatever its command did: read the item back to know it is there
    const back = await run($, macGet(name))
    if (!back || back.exitCode !== 0 || back.stdout.trim() !== toB64(secret)) throw new Error(why(r && r.stderr ? r : back, 'storing the key in the Keychain'))
  } else if (w.route === 'secret-service') {
    const r = await run($, linuxPut(name, secret))
    if (!r || r.exitCode !== 0) throw new Error(why(r, 'storing the key in the Secret Service'))
  } else {
    const r = await run($, filePut(w.location, name, secret))
    if (parseTagged(r)?.kind !== 'stored') throw new Error(why(r, 'writing the key file'))
  }
  return w
}

/** The key, or undefined when this device has none of that name; rejects when the store cannot be read. */
export async function getKey($: any, name: string): Promise<string | undefined> {
  mustName(name)
  const w = await where($)
  if (w.route === 'dpapi') {
    if (w.refused) throw new Error(w.refused)
    const r = await run($, winGet(w.location, name))
    const t = parseTagged(r)
    if (t?.kind === 'key') return t.secret
    if (t?.kind === 'none') return undefined
    throw new Error(why(r, 'reading the key with DPAPI'))
  }
  if (w.route === 'keychain') {
    const r = await run($, macGet(name))
    if (r?.exitCode === 0 && isB64(r.stdout.trim())) return fromB64(r.stdout.trim())
    if (r?.exitCode !== 44) throw new Error(why(r, 'reading the key from the Keychain'))
  } else if (w.route === 'secret-service') {
    const r = await run($, linuxGet(name))
    if (r?.exitCode === 0 && r.stdout.trim() !== '' && isB64(r.stdout.trim())) return fromB64(r.stdout.trim())
    if (!serviceUp(r)) throw new Error(why(r, 'reading the key from the Secret Service'))
  }
  // macOS and Linux: a key kept in the fallback file (forced, or stored while the Secret Service was down)
  const dir = await fileDir($).catch(none)
  if (!dir) return undefined
  const r = await run($, fileGet(dir, name))
  const t = parseTagged(r)
  if (t?.kind === 'key') return t.secret
  if (t?.kind === 'none') return undefined
  throw new Error(why(r, 'reading the key file'))
}

/** Removes the key wherever this device keeps it; resolves whether there was one. */
export async function removeKey($: any, name: string): Promise<boolean> {
  mustName(name)
  const os = await osOf($)
  if (os === 'windows') {
    const r = await run($, winRemove(await winDir($), name))
    const t = parseTagged(r)
    if (t?.kind === 'removed' || t?.kind === 'none') return t.kind === 'removed'
    throw new Error(why(r, 'removing the DPAPI key'))
  }
  let removed = false
  if (os === 'macos') {
    const r = await run($, macRemove(name))
    if (r?.exitCode === 0) removed = true
    else if (r?.exitCode !== 44) throw new Error(why(r, 'removing the key from the Keychain'))
  } else {
    const had = await run($, linuxGet(name), 15000)
    if (had?.exitCode === 0 && had.stdout.trim() !== '') {
      const r = await run($, linuxRemove(name))
      if (!r || r.exitCode !== 0) throw new Error(why(r, 'removing the key from the Secret Service'))
      removed = true
    }
  }
  const dir = await fileDir($).catch(none)
  if (dir) {
    const r = await run($, fileRemove(dir, name))
    const t = parseTagged(r)
    if (t?.kind === 'removed') removed = true
    else if (t?.kind !== 'none') throw new Error(why(r, 'removing the key file'))
  }
  return removed
}

/** A key served once on a named pipe: `pipe` for Tailcat's --key=, `done` when it was read or gave up, `stop` to end it. */
export type PipeHandle = { pipe: string; done: Promise<'served' | 'timeout' | 'none' | 'failed'>; stop: () => Promise<void> }

/**
 * Windows only: serves the key `name` once on \\.\pipe\to-key-<random>, so `tailcat --key=<pipe> …` reads it with no
 * key file on the disk. Resolves once the pipe exists; start the reader then. The pipe is read once: a Tailcat
 * command that hands --key on to a child (ssh, cp) needs a pipe per read.
 */
export async function servePipe($: any, name: string, opts: { waitMs?: number } = {}): Promise<PipeHandle> {
  mustName(name)
  const w = await where($)
  if (w.os !== 'windows') throw new Error('a named pipe for the key is Windows only')
  if (w.refused) throw new Error(w.refused)
  const c = servePipeCommand(w.location, name, pipeName(crypto.getRandomValues(new Uint8Array(16))), opts.waitMs)
  const s = $.process.spawn({ argv: c.argv, env: c.env })
  let out = ''
  let err = ''
  for (;;) {
    const r = await s.next()
    if (r.done) {
      const how = pipeOutcome(out, r.value?.code ?? null)
      throw new Error(how === 'none' ? `this device has no key named ${name}` : `serving the key failed: ${(errText(err) || out).replace(/\s+/g, ' ').trim().slice(0, 200)}`)
    }
    if (r.value.stream === 'stdout') out += r.value.text
    else err += r.value.text
    const pipe = pipeReady(out)
    if (pipe) {
      const done = (async () => {
        for (;;) {
          const n = await s.next()
          if (n.done) return pipeOutcome(out, n.value?.code ?? null)
          if (n.value.stream === 'stdout') out += n.value.text
        }
      })().catch(() => 'failed' as const)
      return { pipe, done, stop: async () => void (await s.return?.(undefined).catch(none)) }
    }
  }
}

// ── The SSH key setting, in vault.json beside the keys (a path only, never the key) ──

async function settingsPath($: any, os: Os): Promise<string | undefined> {
  const dir = os === 'windows' ? await winDir($).catch(none) : await fileDir($).catch(none)
  return dir ? settingsFile(dir) : undefined
}
async function readSshKey($: any, os: Os): Promise<string | undefined> {
  const p = await settingsPath($, os)
  if (!p || !(await $.fs.exists(p).catch(() => false))) return undefined
  try {
    const v = JSON.parse(String(await $.fs.read(p))).sshKey
    return typeof v === 'string' && v !== '' ? v : undefined
  } catch {
    return undefined
  }
}

/**
 * Records that this device uses an existing SSH key for the SSH-over-Tailcat route (#84). `path` names either half
 * (~ allowed); both must exist and be one ed25519 or ed25519-sk pair. Resolves the private key's path; rejects why not.
 */
export async function useSshKey($: any, path: string): Promise<string> {
  const os = await osOf($)
  const home = await homeOf($)
  const spelled = path.trim().replace(/^~(?=$|[\\/])/, home)
  if (spelled === '' || (spelled.startsWith('~') && !home)) throw new Error('give the path of the SSH key')
  const { priv, pub } = sshPair(spelled)
  const pubText = await $.fs.read(pub).catch(none)
  if (pubText === undefined) throw new Error(`${pub} cannot be read; the key's public half must sit beside it`)
  const privText = await $.fs.read(priv).catch(none)
  if (privText === undefined) throw new Error(`${priv} cannot be read`)
  const ok = checkSshPair(String(privText), String(pubText))
  if (!ok.ok) throw new Error(ok.why)
  const p = await settingsPath($, os)
  if (!p) throw new Error('there is no local folder for the vault settings')
  let was: Record<string, unknown> = {}
  if (await $.fs.exists(p).catch(() => false)) {
    try {
      was = JSON.parse(String(await $.fs.read(p)))
    } catch {
      was = {}
    }
  }
  await $.fs.write(p, JSON.stringify({ ...was, sshKey: priv }, null, 1))
  return priv
}

/** Forgets the recorded OS (tests that fake more than one platform). */
export const resetVault = () => {
  local.os = undefined
}
