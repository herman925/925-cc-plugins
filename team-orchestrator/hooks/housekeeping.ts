// Housekeeping by role: leftover shells and runtimes (bash, sh, node, python, conhost) clog the PC with
// micro-stutters, so every team member cleans up after itself and every head checks on its reports.
//
//  - A worker that sends a message to its own boss is reminded to close what it started and delete its scratch.
//  - A head that hears from one of its reports is reminded to scan for that worker's leftovers and tell it to
//    clean up. A head never kills another session's processes itself, and nobody kills by name machine-wide.
//
// Pure rules from the roster alone (no $), so a test can call them.

import type { Member } from '../types'

export const WORKER_NOTE =
  'HOUSEKEEPING (Team Orchestrator, mandatory): you just reported to your boss. Now close every process YOUR ' +
  'session started (bash.exe, sh.exe, node.exe, python*.exe, conhost.exe; trace them to your own claude.exe), ' +
  'delete your scratch and /tmp files, and tell your boss "clean". Touch only processes your own session started.'

export const HEAD_NOTE = (worker: string) =>
  `HOUSEKEEPING (Team Orchestrator, mandatory): ${worker} just reported to you. Before going on, scan for ` +
  `leftover processes from ${worker}'s session (bash.exe, sh.exe, node.exe, python*.exe, conhost.exe owned by ` +
  `its claude.exe, or orphans whose owner is gone) and tell ${worker} by SendMessage to close the processes it ` +
  'started and delete its scratch and /tmp files, then confirm "clean". Do not kill another session\'s processes ' +
  'yourself, and never kill by name machine-wide.'

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

/** The note for a peer message a member receives, or undefined: only a report from one of its own reports counts. */
export function onReceive(me: Member, list: Member[], text: string): string | undefined {
  const from = senderOf(text)
  if (!from) return undefined
  const worker = list.find(m => m !== me && m.boss === me.name && names(m).includes(from.toLowerCase()))
  return worker ? HEAD_NOTE(worker.name) : undefined
}
