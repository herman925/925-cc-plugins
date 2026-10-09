// Windows, macOS and Linux (0.5.06). Pure rules, so a test can fake each platform.
//
//  - Which deletes the mod may approve on a member's behalf, so routine clean-up never waits for the person.
//    Workers: only inside their own session folder under the Claude temp folder. Heads and leads: also anywhere in the
//    system temp folder and in the project's scratch folder (default .claude/scratch). Anything else still asks.
//  - The leftover-process count from `ps` output on macOS and Linux (Windows keeps its PowerShell count).

/** Forward slashes, a drive letter in Git Bash form (/c/...) as c:/..., no trailing slash; the case kept. */
export const keepPath = (p: string) =>
  p
    .replace(/\\/g, '/')
    .replace(/^\/([a-zA-Z])\//, '$1:/')
    .replace(/\/+$/, '')

/** keepPath, lower case for comparing (the same length, so a prefix found here cuts keepPath too). */
export const normPath = (p: string) => keepPath(p).toLowerCase()

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

/** One target of an approvable delete: the allowed root it sits under and the path, both absolute with the case kept. */
export type ScratchTarget = { root: string; path: string }
/** An approvable delete: its targets, and whether it deletes folders with what is in them. */
export type ScratchPlan = { targets: ScratchTarget[]; recursive: boolean }

/**
 * The delete, when a Bash or PowerShell command is only a delete of paths the member may clean up without asking;
 * undefined otherwise. Only plain literal paths (0.5.11, #60): no wildcard (* ? [ ]) and no trailing slash, since
 * either can carry the shell through a link into real files. Links themselves are checked by linkFree, on the disk.
 */
export function scratchDeletePlan(command: string, c: ScratchContext): ScratchPlan | undefined {
  const w = words(command)
  if (!w || w.length < 2 || !DELETE.test(w[0] as string)) return undefined
  const raws: string[] = []
  let recursive = false
  for (let i = 1; i < w.length; i++) {
    const t = w[i] as string
    if (/^-(path|literalpath)$/i.test(t)) {
      if (w[i + 1] !== undefined) raws.push(w[++i] as string)
      continue
    }
    if (VALUE_OPTS.test(t)) {
      i++
      continue
    }
    // rm -r/-rf/-R/--recursive, Remove-Item -Recurse (or any prefix of it), rd /s, rmdir /s, del /s. Any option with
    // an r in it counts (-Force too): taking a delete as recursive only adds a check, never an approval.
    if (/^-/.test(t)) {
      if (/r/i.test(t)) recursive = true
      continue
    }
    if (/^\/[a-z]$/i.test(t)) {
      if (/^\/s$/i.test(t)) recursive = true
      continue
    }
    raws.push(t)
  }
  if (raws.length === 0) return undefined
  const cwd = keepPath(c.cwd)
  const temps = c.temps.filter(Boolean).map(normPath)
  const claudeTemps = temps.map(t => `${t}/claude`)
  const scratch = c.projectScratch ? normPath(c.projectScratch) : ''
  const id = c.sessionId.toLowerCase()
  const targets: ScratchTarget[] = []
  for (const raw of raws) {
    if (raw.startsWith('~') || /[*?[\]]/.test(raw) || /[\\/]$/.test(raw)) return undefined
    let k = keepPath(raw)
    if (!isAbs(k.toLowerCase())) k = `${cwd}/${k}`
    const p = k.toLowerCase()
    if (p.split('/').some(s => s === '..' || s === '.')) return undefined
    const roots = [
      ...(id !== '' && p.includes(id) ? claudeTemps.filter(t => under(p, t) && p !== t) : []),
      ...(c.head ? temps.filter(t => under(p, t) && p !== t) : []),
      ...(c.head && scratch !== '' && under(p, scratch) && p !== scratch ? [scratch] : []),
    ]
    // the longest allowed root above the path: the walk then checks every folder below it
    const root = roots.sort((a, b) => b.length - a.length)[0]
    if (root === undefined) return undefined
    targets.push({ root: k.slice(0, root.length), path: k })
  }
  return { targets, recursive }
}

/** Whether a Bash or PowerShell command is only a delete of paths the member may clean up without asking (by its words alone). */
export const scratchDeleteAllowed = (command: string, c: ScratchContext): boolean => scratchDeletePlan(command, c) !== undefined

/** One entry of a folder listing, as $.fs.list gives it. */
export type ListEntry = { name: string; kind: string; isLink: boolean }
/** The most entries a recursive delete's folder may hold for the mod to approve it; above it, the person is asked. */
export const WALK_CAP = 2000

/**
 * Whether the delete can be approved on the disk as it is now: every folder from the allowed root down to the target,
 * and the target itself, is a plain folder or file (no symbolic link, no junction, nothing the listing cannot name),
 * and for a recursive delete nothing inside the target is a link either (older PowerShell follows a junction it finds
 * inside a folder it deletes). A path that cannot be listed, or a folder over WALK_CAP entries, is not approved.
 * Hard links are left alone: deleting one removes that name only.
 */
export async function linkFree(plan: ScratchPlan, list: (path: string) => Promise<readonly ListEntry[]>): Promise<boolean> {
  const unsafe = (x: ListEntry) => x.isLink || (x.kind !== 'file' && x.kind !== 'dir')
  const find = (entries: readonly ListEntry[], name: string) => entries.find(x => x.name === name) ?? entries.find(x => x.name.toLowerCase() === name.toLowerCase())
  try {
    for (const t of plan.targets) {
      const below = t.path.slice(t.root.length + 1).split('/').filter(s => s !== '')
      let at = t.root
      let last: ListEntry | undefined
      for (const seg of below) {
        last = find(await list(at), seg)
        if (!last || unsafe(last)) return false
        at = `${at}/${last.name}`
      }
      if (!last) return false
      if (!plan.recursive || last.kind !== 'dir') continue
      const queue = [at]
      let seen = 0
      while (queue.length > 0) {
        const dir = queue.shift() as string
        for (const x of await list(dir)) {
          if (++seen > WALK_CAP || unsafe(x)) return false
          if (x.kind === 'dir') queue.push(`${dir}/${x.name}`)
        }
      }
    }
    return true
  } catch {
    return false
  }
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
