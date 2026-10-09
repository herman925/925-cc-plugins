// Role files (0.5.04). Each member's role lives in .claude/team-orchestrator/roles/<name>.md, not in a chat message
// that a summary can shrink. The session is started with a short pointer in its system prompt (--append-system-prompt):
// who it is, its boss, the one rule that matters most for its level, and the path of its role file. The file is read
// once; when the team changes the mod rewrites it and Claude Code tells the session what changed.
//
// The file has two parts. Above the marker: generated from the roster, rewritten on every change. Below it: the
// person's own notes (a voice, a working style, extra rules), never touched by the mod.
//
// Pure rules from the roster alone (no $), so a test can call them.

import type { Member } from '../types'
import { roleFile } from './status'

export const MARKER = '<!-- END OF THE GENERATED PART. The Team Orchestrator rewrites everything above this line when the team changes. Write your own notes below it. -->'

const NOTES =
  '## Personality and notes\r\n\r\n' +
  '(Optional. Add a voice, a working style or extra rules for this member here. The Team Orchestrator never changes this part.)\r\n'

const kind = (x: Member, list: Member[]) => (x.boss === 'user' || x.level === 1 ? 'head' : list.some(k => k.boss === x.name) ? 'lead' : 'worker')
const bossLine = (m: Member) => (m.boss === 'user' ? 'the user (the person at the keyboard)' : m.boss)

/** The generated part of a member's role file. list: the member's team and every boss above it. */
export function roleText(m: Member, list: Member[]): string {
  const kids = list.filter(x => x.boss === m.name)
  const peers = list.filter(x => x.name !== m.name && list.some(k => k.boss === x.name))
  const manages = kids.length > 0
  const lines = [
    `# ${m.name}`,
    '',
    `Team: ${m.team}. Role: ${m.role}.`,
    `Boss: ${bossLine(m)}.`,
    ...(manages ? [`Direct reports: ${kids.map(k => k.name).join(', ')}.`] : []),
    '',
    '## Your job',
    '',
    manages
      ? 'You orchestrate. You decide, plan and instruct; you do not do the tasks yourself. Give the work to your direct reports and review what they send back. Do not go around a lead to instruct someone else\'s worker.'
      : 'You do the tasks your boss gives you and report the results back to your boss.',
    '',
    '## Messages',
    '',
    ...(manages
      ? [
          '- Message your direct reports with the team_message tool (mcp__team-orchestrator__team_message, { to, message }), not SendMessage. A report may not be running yet, or may have been closed while idle; team_message starts it and then delivers.',
          `- Message your boss${peers.length ? ` and the other heads and leads (${peers.map(p => p.name).join(', ')})` : ''} with SendMessage.`,
        ]
      : ['- Talk only to your boss, with SendMessage. Do not message your boss\'s boss, other leads or other workers unless your boss names one to you.']),
    '- If SendMessage says a teammate\'s name is ambiguous or unknown, use team_message with the plain name instead.',
    '- Never type into another member\'s terminal (orca terminal send) to message it.',
    '',
    '## Housekeeping',
    '',
    'After each task, close every process your session started (bash, sh, node, python, conhost), stop browser-automation servers you are not using, delete your scratch and temporary files, and tell your boss "clean". Touch only what your own session started.',
    '',
    '## The team',
    '',
    ...list.map(x => `- ${x.name}: ${kind(x, list)}, reports to ${x.boss === 'user' ? 'the user' : x.boss}. ${x.role}`),
    '',
    '## Team files',
    '',
    'The team lives in .claude/team-orchestrator/. roster.json is the structure; never edit it by hand. status/<name>.json is each member\'s live status, which the Team Orchestrator writes for its own session; never edit another member\'s. settings.json holds the team settings. This file is ' + roleFile(m.name) + '.',
    '',
  ]
  return lines.join('\r\n')
}

/** The whole file: the generated part, the marker, and the notes kept from the file as it was (or the empty notes). */
export function mergeRole(existing: string | undefined, generated: string): string {
  const at = existing?.indexOf(MARKER) ?? -1
  const notes = existing && at >= 0 ? existing.slice(at + MARKER.length).replace(/^\r?\n/, '') : `\r\n${NOTES}`
  return `${generated}${MARKER}\r\n${notes}`
}

// a shell types the start command (cmd.exe on Windows, sh or zsh elsewhere): no double quote (it would end the
// argument), no % $ ` or backslash (variables and escapes), no line breaks
const safe = (s: string) => s.replace(/["%$`\\\r\n]+/g, ' ')

/** The system-prompt pointer a member starts with: short, because it is sent on every turn. */
export function pointer(m: Member, list: Member[]): string {
  const manages = list.some(x => x.boss === m.name)
  const rule = manages
    ? 'You plan, delegate and review; you do not do the work yourself. Message your direct reports with the team_message tool, not SendMessage.'
    : 'You do the tasks your boss gives you and report back to your boss only, with SendMessage.'
  return safe(
    `You are ${m.name}, a member of the Team Orchestrator team '${m.team}'. Your boss is ${bossLine(m)}. ${rule} ` +
      `Your full role is in the file .claude/team-orchestrator/${roleFile(m.name)}. Read it before your first action and follow it. ` +
      'Read it again after any conversation summary, or when you are told it changed.',
  )
}

/** The first prompt of a member started at Create: confirm it read its role, then wait. */
export const WELCOME = 'Read your role file now (its path is in your system prompt). Then reply with Noted and one line that restates your role and your boss, and wait for instructions.'

/** Who a team's members need to know: the team, every boss above it, and the direct reports it has in other teams (a CEO's heads). */
export function orgOf(all: Member[], team: string): Member[] {
  const org = new Set(all.filter(m => m.team === team).map(m => m.name))
  for (let grew = true; grew; ) {
    grew = false
    for (const m of all) if (org.has(m.name)) for (const b of all) if (b.name === m.boss && !org.has(b.name)) (org.add(b.name), (grew = true))
  }
  for (const m of all) if (m.team === team) for (const k of all) if (k.boss === m.name) org.add(k.name)
  return all.filter(m => org.has(m.name))
}
