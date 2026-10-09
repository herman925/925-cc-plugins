// Windows, macOS and Linux (0.5.06). Pure rules, so a test can fake each platform.
//
//  - Which deletes the mod may approve on a member's behalf, so routine clean-up never waits for the person.
//    Workers: only inside their own session folder under the Claude temp folder. Heads and leads: also anywhere in the
//    system temp folder and in the project's scratch folder (default .claude/scratch). Anything else still asks.
//  - The leftover-process count from `ps` output on macOS and Linux (Windows keeps its PowerShell count).

/** Forward slashes, a drive letter in Git Bash form (/c/...) as c:/..., no trailing slash, lower case for comparing. */
export const normPath = (p: string) =>
  p
    .replace(/\\/g, '/')
    .replace(/^\/([a-zA-Z])\//, '$1:/')
    .replace(/\/+$/, '')
    .toLowerCase()

const isAbs = (p: string) => /^([a-z]:\/|\/)/.test(p)
const under = (p: string, root: string) => root !== '' && (p === root || p.startsWith(`${root}/`))

/** Shell words, with single and double quotes removed; undefined when the line is more than one plain command. */
export function words(command: string): string[] | undefined {
  // a pipe, chain, redirect, substitution or variable makes the targets unknowable: never approve those
  if (/[;&|<>`\n\r]|\$\(|\$\{|\$[A-Za-z_]/.test(command)) return undefined
  const out: string[] = []
  for (const m of command.trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

export type ScratchContext = {
  /** the session's working folder, for relative paths */
  cwd: string
  sessionId: string
  /** the member has reports (a head or a lead) */
  head: boolean
  /** the system temp folder(s): TEMP / TMP / TMPDIR, and /tmp */
  temps: string[]
  /** the project's scratch folder, absolute; '' for none */
  projectScratch: string
}

const DELETE = /^(rm|rmdir|del|erase|rd|remove-item|ri)$/i
// options that take a value: Remove-Item's -Path / -LiteralPath name the target, the rest are skipped with their value
const VALUE_OPTS = /^-(path|literalpath|filter|include|exclude)$/i

/** Whether a Bash or PowerShell command is only a delete of paths the member may clean up without asking. */
export function scratchDeleteAllowed(command: string, c: ScratchContext): boolean {
  const w = words(command)
  if (!w || w.length < 2 || !DELETE.test(w[0] as string)) return false
  const targets: string[] = []
  for (let i = 1; i < w.length; i++) {
    const t = w[i] as string
    if (/^-(path|literalpath)$/i.test(t)) {
      if (w[i + 1] !== undefined) targets.push(w[++i] as string)
      continue
    }
    if (VALUE_OPTS.test(t)) {
      i++
      continue
    }
    if (/^-/.test(t) || /^\/[a-z]$/i.test(t)) continue // rm -rf, -Recurse, -Force, del /q
    targets.push(t)
  }
  if (targets.length === 0) return false
  const cwd = normPath(c.cwd)
  const temps = c.temps.filter(Boolean).map(normPath)
  const claudeTemps = temps.map(t => `${t}/claude`)
  const scratch = c.projectScratch ? normPath(c.projectScratch) : ''
  const id = c.sessionId.toLowerCase()
  return targets.every(raw => {
    if (raw.startsWith('~')) return false
    let p = normPath(raw)
    if (!isAbs(p)) p = `${cwd}/${p}`
    if (p.split('/').includes('..')) return false
    const ownSession = id !== '' && p.includes(id) && claudeTemps.some(t => under(p, t))
    if (ownSession) return true
    if (!c.head) return false
    return temps.some(t => under(p, t) && p !== t) || (scratch !== '' && under(p, scratch) && p !== scratch)
  })
}

const LEFTOVER = /^(bash|zsh|sh|fish|dash|node|deno|bun|python[\d.]*)$/

/**
 * Leftover shells and runtimes under the member's own claude process, from `ps -eo pid=,ppid=,args=` output:
 * -1 when no process carries the session id (the count is unknown, not zero).
 */
export function countFromPs(text: string, sessionId: string): number {
  const procs = text
    .split(/\r?\n/)
    .map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] as string }))
  const me = procs.find(p => p.args.includes(sessionId) && /\bclaude\b/.test(p.args))
  if (!me) return -1
  const byPid = new Map(procs.map(p => [p.pid, p]))
  const name = (args: string) => (args.split(/\s+/)[0] ?? '').split('/').pop()!.replace(/^-/, '')
  let n = 0
  for (const p of procs) {
    if (p === me || !LEFTOVER.test(name(p.args))) continue
    let x = p
    for (let i = 0; i < 8; i++) {
      const up = byPid.get(x.ppid)
      if (!up) break
      if (up.pid === me.pid) {
        n++
        break
      }
      x = up
    }
  }
  return n
}
