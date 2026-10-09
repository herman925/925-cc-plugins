// Who this session is, on the roster: the identity ladder of #57. Pure rules from the roster and this session's facts
// (no $), so a test can call them.
//
// Three facts are checked against each member: the tab (this session's ORCA_TERMINAL_HANDLE against the member's
// handle), the session id and the name (the registry's name, else the transcript title).
//
//  | facts that match          | treated as                        | roster update                                  |
//  | tab + id + name           | X, full                           | none                                           |
//  | tab + id (new name)       | X, full                           | follow and relabel (name, address, bosses)      |
//  | tab + name (new id)       | X, full                           | sessionId = the new id                         |
//  | id + name, other tab      | X if X's tab is gone, else held   | handle = this tab                              |
//  | tab only                  | X, full, re-attached              | id and name taken; the role-file note is sent  |
//  | id only, or name only     | held (restricted)                 | none                                           |
//  | nothing                   | not on the team                   | none                                           |
//
// No tab handle at all (a session outside Orca) is "unknown", not a mismatch. The machine's session registry
// (~/.claude/sessions/<pid>.json) vouches for it in place of the tab when it lists this session's id in a folder under
// the project root: it is then on this machine. That proof stands in for the tab only next to an id or a name, never
// alone, and never while the member it points at is live somewhere else (that would be a second copy).
//
// A member whose home is another PC (0.5.12, #64) is never matched by tab or registry here: handles and the registry
// are valid only on their own machine. An id and a name alone then hold the session for the user to decide, like any other doubt.
// A session confirmed as a member with no machine recorded takes this one.

import type { Member } from '../types'
import { AGENT_TOOL, KEYWORDS, WRITE_TOOLS } from './guard'
import type { Grants, Verdict } from './guard'
import { roleFile } from './status'
import { isAway } from './changes'

export type Level = 'full' | 'restricted' | 'none'
export type Row = 'tab+id+name' | 'tab+id' | 'tab+name' | 'id+name' | 'tab' | 'id' | 'name' | 'none'

/** This session's own facts. */
export type Facts = {
  /** its Orca tab handle (term_…); '' outside Orca, which is unknown, not a mismatch */
  tab: string
  sessionId: string
  /** the session's name from the registry, else its transcript title; '' when it has none */
  name: string
}

export type Identity = {
  level: Level
  /** the member this session is (full) or looks like (restricted), as it stands after the updates */
  member?: Member
  row: Row
  /** the roster after the updates (the same array when nothing changed) */
  list: Member[]
  changed: boolean
  /** set when the member was relabelled to the session's new name: its old name */
  renamedFrom?: string
  /** a fresh session in the member's tab, taken on as the member: it gets the role-file note once */
  reattached: boolean
  /** why a restricted session is held, in a sentence; '' otherwise */
  why: string
}

export const keyOf = (m: Member) => `${m.team}|${m.name}`
const namesOf = (m: Member) => [m.address, m.name].filter((x): x is string => !!x)

// the rows in the order the ladder tries them; the first four and "tab" are full, the rest held
const RANK: Row[] = ['tab+id+name', 'tab+id', 'tab+name', 'id+name', 'tab', 'id', 'name']

/** A name some other member of the project already goes by. */
export const nameTaken = (list: Member[], name: string, except?: Member) =>
  list.some(m => m !== except && namesOf(m).some(n => n.toLowerCase() === name.toLowerCase()))

/**
 * The member (by team|name) renamed to `to`: its name and address take the new name, and the members that report to
 * it follow. A boss is matched in the member's own team first, so another team's member of the same name is untouched.
 */
export function relabel(list: Member[], key: string, to: string): Member[] {
  const x = list.find(m => keyOf(m) === key)
  if (!x || to === '' || to === x.name) return list
  const reportsTo = (m: Member) => m.boss === x.name && (m.team === x.team || !list.some(o => o !== x && o.team === m.team && o.name === x.name))
  return list.map(m => (m === x ? { ...m, name: to, address: to } : reportsTo(m) ? { ...m, boss: to } : m))
}

/**
 * Who this session is.
 *  - list: the roster
 *  - facts: this session's tab (or ''), id and name
 *  - local: the session registry lists this session's id in a folder under the project root (same machine)
 *  - live: the members (team|name) that are running somewhere else right now: a live tab, or another live session
 *    with their id
 */
export function identify(args: { list: Member[]; facts: Facts; local: boolean; live: ReadonlySet<string>; here?: string }): Identity {
  const { list, facts, local, live } = args
  const here = args.here ?? ''
  const away = (m: Member) => isAway(m, here)
  const none: Identity = { level: 'none', row: 'none', list, changed: false, reattached: false, why: '' }
  if (list.length === 0) return none
  const tabKnown = facts.tab !== ''
  const rowOf = (m: Member): Row => {
    const id = facts.sessionId !== '' && m.sessionId === facts.sessionId
    const name = facts.name !== '' && namesOf(m).includes(facts.name)
    // the tab: a real match or mismatch where both sides have one; else the registry's proof, which stands in for
    // the tab only beside an id or a name, and only while the member is not live elsewhere
    const both = tabKnown && m.handle !== ''
    const tab = away(m) ? false : both ? m.handle === facts.tab : local && !live.has(keyOf(m)) && (id || name)
    if (tab && id && name) return 'tab+id+name'
    if (tab && id) return 'tab+id'
    if (tab && name) return 'tab+name'
    if (id && name) return 'id+name'
    if (tab) return 'tab'
    if (id) return 'id'
    if (name) return 'name'
    return 'none'
  }
  const rows = list.map(m => ({ m, row: rowOf(m) })).filter(r => r.row !== 'none')
  if (rows.length === 0) return none
  const best = Math.min(...rows.map(r => RANK.indexOf(r.row)))
  const row = RANK[best] as Row
  const top = rows.filter(r => r.row === row)
  const x = (top[0] as { m: Member }).m
  const held = (why: string): Identity => ({ level: 'restricted', member: x, row, list, changed: false, reattached: false, why })
  // two members fit equally well (two of the same name, say): which one is unknown, so neither is granted
  if (top.length > 1) return held(`it fits ${top.map(r => r.m.name).join(' and ')} equally well`)
  const elsewhere = (why: string) => (tabKnown ? why : `${why}, and this session has no Orca tab`)
  if (row === 'id+name') {
    if (away(x)) return held(`its home is ${x.machine}, so this may be a second copy of the session running there`)
    if (!tabKnown && !local) return held('it is not in this machine\'s session registry, so it may be running on another device')
    if (live.has(keyOf(x))) return held(`${x.name}'s own tab is still open, so this looks like a second copy`)
  }
  if (row === 'id') return held(elsewhere(`only its session id matches ${x.name}; its tab and its name do not`))
  if (row === 'name') return held(elsewhere(`only its name matches ${x.name}; its tab and its session id do not`))
  // full from here: the roster follows the session
  let next = list
  const set = (patch: Partial<Member>) => {
    next = next.map(m => (keyOf(m) === keyOf(x) ? { ...m, ...patch } : m))
  }
  if (row === 'tab+name' || row === 'tab') set({ sessionId: facts.sessionId })
  // its home is this machine, recorded when the roster has none for it (a member from another PC never gets this far)
  if (here !== '' && !x.machine) set({ machine: here })
  if (row === 'id+name' && tabKnown) {
    set({ handle: facts.tab })
    // a member still recorded on this tab is not in it any more: a close of that member must not close this one
    next = next.map(m => (keyOf(m) !== keyOf(x) && m.handle === facts.tab ? { ...m, handle: '' } : m))
  }
  // a new name (a /rename, or a fresh session's own name) is followed unless another member already goes by it
  let renamedFrom: string | undefined
  const wantsName = (row === 'tab+id' || row === 'tab') && facts.name !== '' && !namesOf(x).includes(facts.name)
  if (wantsName && !nameTaken(list, facts.name, x)) {
    next = relabel(next, keyOf(x), facts.name)
    renamedFrom = x.name
  }
  const key = renamedFrom === undefined ? keyOf(x) : `${x.team}|${facts.name}`
  const member = next.find(m => keyOf(m) === key) as Member
  return { level: 'full', member, row, list: next, changed: next !== list, renamedFrom, reattached: row === 'tab', why: '' }
}

/** The one-time note a re-attached session gets on its next prompt. */
export const roleNote = (m: Member) =>
  `You are ${m.name} in team ${m.team}. Your role file is .claude/team-orchestrator/${roleFile(m.name)}; read it now.`

/** The one-time note a held session gets on its next prompt. */
export const holdNote = (m: Member, why: string) =>
  `TEAM ORCHESTRATOR: this session is ON HOLD. It looks like ${m.name} of team ${m.team}, but that is not confirmed (${why}). ` +
  'Until the user decides, it may not write files, use subagents or use any team tool. The team top has been asked to check with the user. ' +
  `Do not act as ${m.name} meanwhile.`

const tag = (m: Member, why: string) => `${m.name} of team ${m.team} (${why})`

/** The sentence a team tool answers a held session with. */
export const holdTool = (tool: string, m: Member, why: string) =>
  `${tool} is on hold: this session looks like ${tag(m, why)} but is not confirmed. Team tools stay off until the user decides whether it is ${m.name}; the team top has been asked.`

/** The strictest guard, for a held session: Agent, Write, Edit and NotebookEdit only with the person's one-turn word. */
export function judgeHeld(args: { me: Member; why: string; tool: string; grants: Grants }): Verdict {
  const { me, why, tool, grants } = args
  const isAgent = tool === AGENT_TOOL
  if (!isAgent && !(WRITE_TOOLS as readonly string[]).includes(tool)) return undefined
  const word = isAgent ? KEYWORDS.agent : KEYWORDS.write
  if (isAgent ? grants.agent : grants.write) return { kind: 'allow', line: `allowed ${tool} on hold (${word}, this turn only)` }
  return {
    kind: 'deny',
    reason:
      `Blocked ${tool}: this session is on hold. It looks like ${tag(me, why)} but is not confirmed, so it may not ` +
      `${isAgent ? 'use subagents' : 'write files'} until the user decides (${word} in the user's next message allows one turn).`,
    line: `blocked ${tool}: session on hold (looks like ${me.name})`,
  }
}

/** The team top above a member: up the boss line to the one that reports to the user. */
export function topOf(list: Member[], x: Member): Member | undefined {
  let cur: Member | undefined = x
  const seen = new Set<string>()
  while (cur && cur.boss !== 'user' && !seen.has(keyOf(cur))) {
    seen.add(keyOf(cur))
    const c: Member = cur
    cur = list.find(m => m.team === c.team && m.name === c.boss) ?? list.find(m => m.name === c.boss)
  }
  return cur && cur.boss === 'user' ? cur : undefined
}

/** A pending identity question: a held session and the member it looks like. */
export type Claim = { sessionId: string; member: string; team: string; tab: string; name: string; why: string; at: number; machine?: string; decision?: 'is' | 'new' | 'reject' }

/** The warning X's head gets once. */
export const headWarning = (c: Claim) =>
  `IDENTITY WARNING (Team Orchestrator): a session (id ${c.sessionId}, name "${c.name || 'none'}", tab ${c.tab || 'none'}) looks like your report ${c.member} ` +
  `of team ${c.team}, but it is not confirmed (${c.why}). It is on hold: no writes, no subagents, no team tools. Do not give it work until the user decides.`

/** What the team top is told: ask the user at once, then apply the answer with member_claim. */
export const topAsk = (c: Claim, boss: string) =>
  `IDENTITY CHECK (Team Orchestrator), act now: a session (id ${c.sessionId}, name "${c.name || 'none'}", tab ${c.tab || 'none'}) looks like ${c.member} ` +
  `of team ${c.team}, but it is not confirmed (${c.why}). It is on hold. Ask the user AT ONCE with AskUserQuestion, with these three options: ` +
  `(1) "This is ${c.member}": the roster takes its id, tab and name. ` +
  `(2) "New member under ${boss}": it joins as a worker with its own role file. ` +
  '(3) "Reject": it stays on hold, off the team. ' +
  `Then apply the answer with member_claim { sessionId: "${c.sessionId}", decision: "is" | "new" | "reject", member: "${c.member}" }.`

/** A name for a new member that nobody on the roster goes by: the wanted one, else the base with a number. */
export function freshName(list: Member[], wanted: string, base: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_ -]/g, '-').trim().slice(0, 40)
  const w = clean(wanted)
  if (w !== '' && !nameTaken(list, w)) return w
  for (let i = 2; ; i++) {
    const n = `${clean(base)}-${i}`
    if (!nameTaken(list, n)) return n
  }
}
