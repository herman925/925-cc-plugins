// New members on a running team (0.5.17, #77). Pure rules from the roster alone (no $), so a test can call them.
//
//  - New member: a member saved "not yet" (pending), with its role file, that starts fresh and briefed on its boss's
//    first team_message, exactly like a member Create leaves for later.
//  - Who may add: you always may (the panel, or your own session that is not on the roster). A head or a lead may only
//    REQUEST members, and only within its purview: its own team and every team whose chain of bosses leads up to it.
//    A request takes effect once you approve it, asked by the team top with AskUserQuestion.
//  - A launch under a team name already on the roster never replaces that team: it is refused, and offers "add" (every
//    launched member joins as a new member) or "merge" (the launched team merges into the one there, by name).

import type { Member } from '../types'

export const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max']

const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40)
const keyOf = (m: Member) => `${m.team}|${m.name}`

/**
 * What a New member is made from. boss '' is the team's head; model and effort 'default' or '' leave it to claude.
 * by: the head or lead that asked for it (member_add); it may be the boss from the team above.
 */
export type NewSpec = { team: string; name: string; role?: string; boss?: string; model?: string; effort?: string; by?: string }

/** A member's boss as the roster names it: the one in its own team first, else the one of that name in any team. */
export const bossOf = (list: Member[], m: Member): Member | undefined =>
  m.boss === 'user' ? undefined : (list.find(x => x.team === m.team && x.name === m.boss) ?? list.find(x => x.name === m.boss))

/** The team's head: its first member whose boss is not in the team. */
export const headOf = (list: Member[], team: string): Member | undefined => {
  const mine = list.filter(m => m.team === team)
  return mine.find(m => !mine.some(x => x.name === m.boss))
}

/** Does `who` sit on m's chain of bosses (m itself not counted)? */
function under(list: Member[], m: Member, who: Member): boolean {
  const seen = new Set<string>()
  for (let b = bossOf(list, m); b && !seen.has(keyOf(b)); b = bossOf(list, b)) {
    if (keyOf(b) === keyOf(who)) return true
    seen.add(keyOf(b))
  }
  return false
}

/** A head (reports to the user, or level 1) or a lead (has reports): the members who may ask for new members. */
export const manages = (list: Member[], me: Member) => me.boss === 'user' || me.level === 1 || list.some(k => keyOf(k) !== keyOf(me) && bossOf(list, k) && keyOf(bossOf(list, k)!) === keyOf(me))

/** The teams in a head's or lead's purview: its own, then every team whose head's chain of bosses leads up to it. */
export function purview(list: Member[], me: Member): string[] {
  const teams = [...new Set(list.map(m => m.team))]
  return [me.team, ...teams.filter(t => t !== me.team && list.some(m => m.team === t && headOf(list, t) === m && under(list, m, me)))]
}

/** Why a head or lead may not ask for a member of `team` under `boss`: '' when it may. */
export function requestProblem(list: Member[], me: Member, team: string, boss = ''): string {
  if (!manages(list, me)) return `${me.name} is a worker: only a head or a lead may ask for new members. Ask your boss.`
  const p = purview(list, me)
  if (!p.includes(team)) return `Refused: team "${team}" is outside ${me.name}'s purview (${p.join(', ')}). A head or lead may ask for members only in its own team and the teams below it.`
  const b = boss && boss !== me.name ? (list.find(m => m.team === team && m.name === boss) ?? list.find(m => m.name === boss)) : undefined
  if (b && !p.includes(b.team)) return `Refused: the boss "${boss}" (team ${b.team}) is outside ${me.name}'s purview (${p.join(', ')}).`
  return ''
}

/** Why a New member cannot be added as given: '' when it can. Names are unique across the project (SendMessage finds a session by name). */
export function newProblem(list: Member[], s: NewSpec): string {
  const team = String(s.team ?? '').trim()
  if (!list.some(m => m.team === team)) return `No team "${team}" on the roster. New members join a team that is running; start a new team from New team (or team_launch).`
  const name = clean(String(s.name ?? '').trim())
  if (name === '') return 'Give the new member a name.'
  const taken = list.find(m => m.name === name || m.address === name)
  if (taken) return `The name "${name}" is taken (team ${taken.team}). Pick another: a name is how teammates reach a session.`
  const boss = String(s.boss ?? '').trim()
  const asker = boss !== '' && boss === s.by && list.some(m => m.name === boss)
  if (boss !== '' && !asker && !list.some(m => m.team === team && m.name === boss)) return `No member "${boss}" in team "${team}" to be the boss.`
  const effort = String(s.effort ?? '').trim()
  if (effort !== '' && !EFFORTS.includes(effort)) return `Effort "${effort}" is not one of ${EFFORTS.join(', ')}.`
  return ''
}

/** The New member as the roster keeps it (no worktree or machine yet: the caller adds those). Check newProblem first. */
export function newMember(list: Member[], s: NewSpec): Member {
  const name = clean(String(s.name).trim())
  const boss = String(s.boss ?? '').trim()
  // the boss in the team, else the head or lead that asked (it may sit in the team above), else the team's head
  const b = boss ? (list.find(m => m.team === s.team && m.name === boss) ?? (boss === s.by ? list.find(m => m.name === boss) : undefined)) : headOf(list, s.team)
  const model = String(s.model ?? '').trim()
  const effort = String(s.effort ?? '').trim()
  return {
    team: s.team, name, address: name, role: String(s.role ?? '').trim() || 'worker', level: b ? b.level + 1 : 1, boss: b ? b.name : 'user',
    handle: '', sessionId: '', state: 'unstarted', ctx: -1, model: model === 'default' ? '' : model, effort: effort === 'default' ? '' : effort,
    sel: false, note: '', briefed: false, noted: false, pending: true, location: 'local',
  }
}

/** A launched member, as team_launch and the form give it (team cleaned). */
export type LaunchSpec = { name: string; role: string; level: number; boss: string; team: string; model?: string; effort?: string; short?: string }

/**
 * A launch into teams already on the roster (mode add or merge). Nobody on the roster is changed or removed.
 *  - add: every launched member is new; a name taken anywhere gets a number (Worker-1 -> Worker-1-2).
 *  - merge: a launched member named like a member of that team is that member, kept as it is; the rest join.
 * Either way a launched member that would report to the user, in a team already there, reports to that team's head
 * instead (a team has one top). Returns the members to add (boss-first) and the names merged into members there.
 */
export function joinLaunch(list: Member[], specs: LaunchSpec[], mode: 'add' | 'merge'): { add: LaunchSpec[]; merged: string[] } {
  const there = new Set(list.map(m => m.team))
  const taken = new Set(list.flatMap(m => [m.name, m.address ?? m.name]))
  const renamed = new Map<string, string>()
  const levels = new Map<string, number>(list.map(m => [`${m.team}|${m.name}`, m.level]))
  const add: LaunchSpec[] = []
  const merged: string[] = []
  for (const s of specs) {
    const base = clean(s.name)
    if (mode === 'merge' && there.has(s.team) && list.some(m => m.team === s.team && m.name === base)) {
      renamed.set(s.name, base)
      merged.push(base)
      continue
    }
    let name = base
    if (taken.has(name) && !there.has(s.team)) name = clean(`${s.team}-${base}`)
    for (let i = 2; taken.has(name); i++) name = clean(`${base}-${i}`)
    taken.add(name)
    renamed.set(s.name, name)
    const head = headOf(list, s.team)
    const boss = s.boss === 'user' ? (there.has(s.team) && head ? head.name : 'user') : (renamed.get(s.boss) ?? clean(s.boss))
    const level = boss === 'user' ? 1 : (levels.get(`${s.team}|${boss}`) ?? [...levels].find(([k]) => k.endsWith(`|${boss}`))?.[1] ?? s.level - 1) + 1
    levels.set(`${s.team}|${name}`, level)
    add.push({ ...s, name, boss, level })
  }
  return { add, merged }
}
