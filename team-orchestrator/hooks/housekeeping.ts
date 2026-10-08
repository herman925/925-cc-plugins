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

const BROWSER =
  'Browser-automation servers (node.exe running playwright/mcp or chrome-devtools-mcp, and their cmd.exe wrappers) ' +
  'under your own claude.exe: if you are not using browser tools, stop them; if you used them, stop them as soon as ' +
  'the browser task is done.'

export const WORKER_NOTE =
  'HOUSEKEEPING (Team Orchestrator, mandatory): you just reported to your boss. Now close every process YOUR ' +
  'session started (bash.exe, sh.exe, node.exe, python*.exe, conhost.exe; trace them to your own claude.exe), ' +
  'delete your scratch and /tmp files, and tell your boss "clean". ' +
  BROWSER +
  ' Touch only processes your own session started.'

export const HEAD_NOTE = (worker: string) =>
  `HOUSEKEEPING (Team Orchestrator, mandatory): ${worker} just reported to you. Before going on, scan for ` +
  `leftover processes from ${worker}'s session (bash.exe, sh.exe, node.exe, python*.exe, conhost.exe owned by ` +
  `its claude.exe, or orphans whose owner is gone), including idle browser-automation servers (playwright/mcp, ` +
  `chrome-devtools-mcp) it is not using, and tell ${worker} by SendMessage to close the processes it started and ` +
  'delete its scratch and /tmp files, then confirm "clean". Do not kill another session\'s processes yourself, and ' +
  'never kill by name machine-wide.'

const names = (m: Member) => [m.address, m.name].filter((x): x is string => !!x).map(x => x.toLowerCase())

// SendMessage's "to" may carry a " [ref]" suffix: "Data-and-Numbers-Lead [8005a7]".
const bareTo = (to: string) => to.replace(/\s*\[[^\]]*\]\s*$/, '').trim().toLowerCase()

/** The note for a member's SendMessage, or undefined: only a message to that member's own boss counts. */
export function onSend(me: Member, list: Member[], to: string): string | undefined {
  if (me.boss === 'user') return undefined
  const boss = list.find(m => m.name === me.boss && m.team === me.team) ?? list.find(m => m.name === me.boss)
  return boss && names(boss).includes(bareTo(to)) ? WORKER_NOTE : undefined
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
  const body = bodyOf(text).replace(/^[\w-]+:\s*/, '') // "Data-and-Numbers-Lead: clean …"
  return body.length <= 400 && /^\W*(all\s+)?clean\b/i.test(body)
}

/**
 * Whether a session polls Orca for the roster: the team's top member (boss "user") does, and so does a session that
 * is not on the roster (the person's own). Every other member only reads the roster file the poller shares.
 */
export const shouldPoll = (me: Member | undefined) => !me || me.boss === 'user'

/** The note for a peer message a member receives, or undefined: only a report from one of its own reports counts. */
export function onReceive(me: Member, list: Member[], text: string): string | undefined {
  const from = senderOf(text)
  if (!from || isCleanConfirmation(text)) return undefined
  const worker = list.find(m => m !== me && m.boss === me.name && names(m).includes(from.toLowerCase()))
  return worker ? HEAD_NOTE(worker.name) : undefined
}
