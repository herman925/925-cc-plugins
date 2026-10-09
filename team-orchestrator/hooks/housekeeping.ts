// Housekeeping by role: leftover shells and runtimes (bash, sh, node, python, conhost) clog the PC with
// micro-stutters, so every team member cleans up after itself and every head checks on its reports.
//
//  - A worker that sends a message to its own boss is reminded to close what it started and delete its scratch.
//  - A head that hears from one of its reports is reminded to scan for that worker's leftovers and tell it to
//    clean up. A head never kills another session's processes itself, and nobody kills by name machine-wide.
//  - A report that is only a cleanup confirmation ("clean") does not trigger the head note again, so a head and a
//    worker never ping-pong confirmations.
//  - Browser-automation MCP servers (Playwright, Chrome DevTools) start in every session and idle for hours: a team
//    of fourteen sessions carried about 140 such processes. Members stop their own unless they are using them.
//
// Pure rules from the roster alone (no $), so a test can call them.

import type { Member } from '../types'

const BROWSER = (win: boolean) =>
  `Browser-automation servers (${win ? 'node.exe' : 'node'} running playwright/mcp or chrome-devtools-mcp${win ? ', and their cmd.exe wrappers' : ''}) ` +
  `under your own ${win ? 'claude.exe' : 'claude process'}: if you are not using browser tools, stop them; if you used them, stop them as soon as ` +
  'the browser task is done.'

// the process names a member looks for, per platform
const PROCS = (win: boolean) =>
  win ? 'bash.exe, sh.exe, node.exe, python*.exe, conhost.exe' : 'bash, zsh, sh, node, python, deno, bun'
const OWNER = (win: boolean) => (win ? 'claude.exe' : 'claude process')

export const workerNote = (win = true) =>
  'HOUSEKEEPING (Team Orchestrator, mandatory): you just reported to your boss. Now close every process YOUR ' +
  `session started (${PROCS(win)}; trace them to your own ${OWNER(win)}), ` +
  'delete your scratch and temporary files (deletes inside your own session\'s temporary folder are approved ' +
  'automatically), and tell your boss "clean" (that word is recorded in your status file on this PC, ' +
  '~/.claude/team-orchestrator/<project>/status/<your name>.json, with a count of your leftover processes). ' +
  BROWSER(win) +
  ' Touch only processes your own session started.'
export const WORKER_NOTE = workerNote(true)

export const HEAD_NOTE = (worker: string, win = true) =>
  `HOUSEKEEPING (Team Orchestrator, mandatory): ${worker} just reported to you. Before going on, scan for ` +
  `leftover processes from ${worker}'s session (${PROCS(win)} owned by ` +
  `its ${OWNER(win)}, or orphans whose owner is gone), including idle browser-automation servers (playwright/mcp, ` +
  `chrome-devtools-mcp) it is not using (its status file on this PC, under ~/.claude/team-orchestrator/, shows its last "clean" ` +
  `and leftover count), and tell ${worker} by SendMessage to close the processes it started and ` +
  'delete its scratch and /tmp files, then confirm "clean". Do not kill another session\'s processes yourself, and ' +
  'never kill by name machine-wide.'

const names = (m: Member) => [m.address, m.name].filter((x): x is string => !!x).map(x => x.toLowerCase())

// SendMessage's "to" may carry a " [ref]" suffix: "Data-and-Numbers-Lead [8005a7]".
const bareTo = (to: string) => to.replace(/\s*\[[^\]]*\]\s*$/, '').trim().toLowerCase()

/** The note for a member's SendMessage, or undefined: only a message to that member's own boss counts. */
export function onSend(me: Member, list: Member[], to: string, win = true): string | undefined {
  if (me.boss === 'user') return undefined
  const boss = list.find(m => m.name === me.boss && m.team === me.team) ?? list.find(m => m.name === me.boss)
  return boss && names(boss).includes(bareTo(to)) ? workerNote(win) : undefined
}

/** The sender name a peer delivery carries (from-name="…"), if any. */
export const senderOf = (text: string) => text.match(/from-name="([^"]+)"/)?.[1]

/** The message body inside a peer delivery's wrapper, or the whole text when there is no wrapper. */
const bodyOf = (text: string) => (text.match(/<cross-session-message[^>]*>([\s\S]*?)<\/cross-session-message>/)?.[1] ?? text).trim()

/**
 * A short reply whose point is that the sender cleaned up ("clean.", "clean. Scratch deleted, no processes left."),
 * not a work report. Longer messages that merely mention cleanup are still reports.
 */
export const isCleanConfirmation = (text: string) => {
  // the body may start with a short speaker label: "Data-and-Numbers-Lead: clean …", "Report lead: clean …"
  const body = bodyOf(text)
  const unlabelled = body.replace(/^[A-Za-z][\w -]{0,38}:\s*/, '')
  const starts = (s: string) => /^\W*(all\s+)?clean\b/i.test(s)
  return body.length <= 800 && (starts(body) || starts(unlabelled))
}

/**
 * Whether a session polls Orca for the roster: the team's top member (boss "user") does, and so does a session that
 * is not on the roster (the person's own). Every other member only reads the roster file the poller shares.
 */
export const shouldPoll = (me: Member | undefined) => !me || me.boss === 'user'

/** The note for a peer message a member receives, or undefined: only a report from one of its own reports counts. */
export function onReceive(me: Member, list: Member[], text: string, win = true): string | undefined {
  const from = senderOf(text)
  if (!from || isCleanConfirmation(text)) return undefined
  const worker = list.find(m => m !== me && m.boss === me.name && names(m).includes(from.toLowerCase()))
  return worker ? HEAD_NOTE(worker.name, win) : undefined
}
