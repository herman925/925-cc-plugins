// Windows, macOS and Linux (0.5.06; interim cleanup limit).
// No cleanup delete is auto-approved in this phase. Process presence checks are on-demand liveness checks for a
// named session id, never a routine resource census.

/** Forward slashes, a drive letter in Git Bash form (/c/...) as c:/..., no trailing slash; the case kept. */
export const keepPath = (p: string) => p.replace(/\\/g, '/').replace(/^\/([a-zA-Z])\//, '$1:/').replace(/\/+$/, '')

/**
 * macOS and Linux (0.5.30): the shell that makes each folder on the way to $1 exist and enterable by its owner. A
 * parent whose default ACL gives its owner rw- passes that to each new folder, so nothing can be written inside it
 * (EACCES). A mended folder that carries a default ACL is set to pass rwx on, so later folders come out right.
 */
export const MEND_DIRS =
  'd=$1; set --; while [ ! -d "$d" ] || [ ! -x "$d" ]; do set -- "$d" "$@"; n=$(dirname -- "$d"); [ "$n" = "$d" ] && exit 1; d=$n; done; ' +
  'for p; do [ -d "$p" ] || mkdir -- "$p" || exit 1; chmod u+rwx -- "$p" || exit 1; ' +
  '[ -z "$(getfacl -dcp -- "$p" 2>/dev/null)" ] || setfacl -m d:u::rwx -- "$p" || true; done'

// ── Is a member's session still running? The send-time crash check (0.5.16, #71 and #65) ──
// Run only when a message goes to a member that has been silent for over 90 s: never on a timer. The machine's session
// registry (~/.claude/sessions/<pid>.json) names the process ids that hold the member's session id; each is then looked
// up by its id alone (one Get-CimInstance query on Windows, `ps -o args= -p <pid>` elsewhere).

/** One process as the check saw it: running or not, and its command line ('' when it cannot be read). */
export type Proc = { running: boolean; args: string }

/** dead: proved gone; alive: a claude process still holds the session; unsure: it cannot be told (so nothing is reopened). */
export type Liveness = { kind: 'dead' } | { kind: 'alive'; pid: number } | { kind: 'unsure'; why: string }

/** The PowerShell that looks the given process ids up in one Get-CimInstance query filtered by ProcessId. */
export const winProcScript = (pids: number[]) => {
  const ids = pids.filter(p => Number.isInteger(p) && p > 0)
  return (
    `$ErrorActionPreference='Stop'; $ps=@(Get-CimInstance Win32_Process -Filter '${ids.map(p => `ProcessId=${p}`).join(' OR ')}'); ` +
    `foreach($i in @(${ids.join(',')})){ $p=$ps|?{$_.ProcessId -eq $i}|select -First 1; if($p){'RUN|'+$i+'|'+[string]$p.CommandLine}else{'NONE|'+$i} }; 'DONE'`
  )
}

/** The processes in winProcScript's output; undefined when the output is not a complete answer for every id. */
export function parseWinProcs(stdout: string, pids: number[]): Map<number, Proc> | undefined {
  const lines = stdout.split(/\r?\n/).map(l => l.trim())
  if (!lines.includes('DONE')) return undefined
  const out = new Map<number, Proc>()
  for (const l of lines) {
    const m = l.match(/^(RUN|NONE)\|(\d+)(?:\|(.*))?$/)
    if (m) out.set(Number(m[2]), { running: m[1] === 'RUN', args: m[3] ?? '' })
  }
  return pids.every(p => out.has(p)) ? out : undefined
}

/** One process from `ps -o args= -p <pid>`: exit 0 with a line is running, exit 1 with nothing is gone, anything else unknown. */
export function psProc(r: { exitCode: number; stdout: string } | undefined): Proc | undefined {
  if (!r) return undefined
  const text = String(r.stdout ?? '').trim()
  if (r.exitCode === 0 && text !== '') return { running: true, args: text }
  if (r.exitCode === 1 && text === '') return { running: false, args: '' }
  return undefined
}

/**
 * Whether the session is alive, from the process ids the registry names for it and what the check found at each.
 *  - a running process whose command line carries the session id: alive
 *  - a running claude process without the id on its command line (a session started as plain `claude`): alive, as
 *    the registry file named after that pid still lists the session
 *  - a running process whose command line cannot be read: unsure
 *  - gone, or now another program (a reused pid): that registry entry is stale and proves nothing
 * No pid at all, or only stale entries: dead. Any pid without an answer: unsure.
 */
export function livenessOf(sessionId: string, pids: number[], procs: ReadonlyMap<number, Proc>): Liveness {
  const id = sessionId.toLowerCase()
  let doubt = ''
  for (const pid of pids) {
    const p = procs.get(pid)
    if (!p) {
      doubt ||= `process ${pid} could not be looked up`
      continue
    }
    if (!p.running) continue
    const args = p.args.toLowerCase()
    if (id !== '' && args.includes(id)) return { kind: 'alive', pid }
    if (args.trim() === '') doubt ||= `process ${pid} is running but its command line cannot be read`
    else if (/\bclaude\b/.test(args)) return { kind: 'alive', pid }
  }
  return doubt ? { kind: 'unsure', why: doubt } : { kind: 'dead' }
}
