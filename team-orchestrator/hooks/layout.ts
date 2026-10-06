// The roster table's columns and the org chart's labels, from the members and the width alone: no $, no state,
// so a test can call them. Every cell is cut with "…" to its width and ends in one space, so nothing wraps and
// two values never touch.

export type Tier = 'wide' | 'medium' | 'narrow'
export type Col = { id: string; w: number; head: string }
export type ColumnPlan = { tier: Tier; nameW: number; cols: Col[]; total: number }

// "[x] " before the name; a row has no buttons (Open and Remove are in Team actions)
export const CHECK = 6

// Cells per tier, each width counting its trailing space. Measured sums: wide 58, medium 38, narrow 18; with the
// checkbox a row needs 62 / 42 / 22 cells plus the name.
const TIERS: { tier: Tier; cols: [string, number][] }[] = [
  { tier: 'wide', cols: [['STATUS', 11], ['CONTEXT', 16], ['MODEL', 14], ['EFFORT', 8], ['BRIEF', 9]] },
  { tier: 'medium', cols: [['STATUS', 11], ['CONTEXT', 12], ['MODEL', 8], ['EFFORT', 7]] },
  { tier: 'narrow', cols: [['STATUS', 2], ['CONTEXT', 5], ['MODEL', 7], ['EFFORT', 4]] },
]
const SHORT_HEAD: Record<string, string> = { STATUS: '', CONTEXT: 'CTX', MODEL: 'MODEL', EFFORT: 'EFF', BRIEF: 'BR' }
// a tier is taken while the name keeps this much (or all of itself, when shorter)
const NAME_ROOM = 16
const NAME_MIN = 8

/** `s` cut to `w` cells, the last one "…" when cut */
export const fit = (s: string, w: number) => (w <= 0 ? '' : s.length <= w ? s : `${s.slice(0, w - 1)}…`)
/** `s` as a cell of `w`: cut to w - 1, then padded, so one space always follows */
export const cell = (s: string, w: number) => fit(s, w - 1).padEnd(w)

/**
 * The widest tier whose cells leave the names room in `width` (the cells inside a card). `hide` is the settings'
 * column toggles, applied on top of the tier.
 */
export function columnPlan(rows: { prefix: string; name: string }[], width: number, hide: string[]): ColumnPlan {
  const want = Math.max(4, ...rows.map(r => r.prefix.length + r.name.length)) + 1
  for (const t of TIERS) {
    const cols = t.cols
      .filter(([id]) => !hide.includes(id))
      .map(([id, w]) => ({ id, w, head: id.length <= w - 1 ? id : (SHORT_HEAD[id] ?? '') }))
    const fixed = CHECK + cols.reduce((a, c) => a + c.w, 0)
    const room = width - fixed
    if (room < Math.min(want, NAME_ROOM) && t.tier !== 'narrow') continue
    const nameW = Math.max(NAME_MIN, Math.min(want, room))
    return { tier: t.tier, nameW, cols, total: fixed + nameW }
  }
  throw new Error('unreachable: the narrow tier is always taken')
}

/** The header line, cut to the same widths as the cells below it. */
export const headerLine = (p: ColumnPlan) => ' '.repeat(CHECK) + cell('NAME', p.nameW) + p.cols.map(c => cell(c.head, c.w)).join('')

/** "Opus 5.5" / "opus-5-5" -> "Opus": the family, for the tiers that are short of room */
export const family = (model: string) => {
  const w = model.split(/[\s-]+/).find(x => x !== '') ?? ''
  return w === '' ? '' : w[0]!.toUpperCase() + w.slice(1)
}
export const EFFORT_SHORT: Record<string, string> = { low: 'L', medium: 'M', high: 'H', xhigh: 'XH', max: 'MAX' }

// ── org chart labels ──
// A member's label is, first of all, the short name the person gave it (`short`), used as typed. Only a member with no
// short name gets one from the rule below, and the rule keeps away from every short name already taken.
// The rule makes the shortest label that tells each member apart, for any names, worked out each draw:
//  1. drop the words the name shares with its team ("Hualong PC Worker A" in team Hualong -> "PC Worker A"),
//     and the words every member of the team starts with;
//  2. try, in order: a leading acronym and the last word ("PC A", "PC Boss"); the initial and a number or letter
//     tail ("Worker 5" -> "W5", "Lead 1 2" -> "L1.2"); the last word ("CEO", "Workers"); the first word
//     ("Research Worker" -> "Research"); all the words left;
//  3. members still alike get the team in front ("Dev Head", "UI Head"), then the whole name.
// Every automatic member starts at its first try; those that clash (with another automatic label or with a short name)
// move one try on, until no two labels are the same. Two characters at least. The rule knows nothing about what a
// name means: "HK University of Hong Kong president" only becomes "HK president" when a person says so.
// Two members that were given the same short name both keep it, and both are flagged (`dup`): the chart adds "!"
// and the roster row says so. Nothing is renamed behind the person's back.
const words = (s: string) => s.split(/[\s_-]+/).filter(w => w !== '')
const isTail = (w: string) => /^\d+$/.test(w) || w.length <= 2

export type LabelInfo = {
  /** what the chart shows (before any "…" cut to fit) */
  label: string
  /** worked out by the rule, not given by the person: drawn dim */
  auto: boolean
  /** the person gave this short name to more than one member */
  dup: boolean
}
type Labelled = { team: string; name: string; short?: string }

/** `s` cut to `max` characters with "…" as the last one, when it is longer */
export const shorten = (s: string, max: number) => (s.length <= max ? s : max <= 1 ? '…' : `${s.slice(0, max - 1)}…`)

export function chartLabelInfo(list: Labelled[]): Map<string, LabelInfo> {
  const given = list.map(m => (m.short ?? '').trim())
  const rests = new Map<string, string[]>()
  for (const team of new Set(list.map(m => m.team))) {
    const mine = list.filter(m => m.team === team)
    const lead = words(team)
    const own = mine.map(m => {
      const w = words(m.name)
      return w.length > lead.length && lead.every((x, i) => w[i]?.toLowerCase() === x.toLowerCase()) ? w.slice(lead.length) : w
    })
    let n = 0
    if (mine.length > 1) while (own.every(w => w.length > n + 1 && w[n] === own[0]![n])) n++
    mine.forEach((m, i) => rests.set(`${m.team}|${m.name}`, own[i]!.slice(n)))
  }
  const ladder = (m: Labelled): string[] => {
    const w = rests.get(`${m.team}|${m.name}`) ?? words(m.name)
    const first = w[0] ?? m.name
    const last = w[w.length - 1] ?? m.name
    const tries: string[] = []
    if (w.length > 1 && /^[A-Z0-9]{2,}$/.test(first)) tries.push(`${first} ${last}`)
    if (w.length > 1 && w.slice(1).every(isTail)) tries.push(`${first[0]}${w.slice(1).join('.')}`)
    tries.push(last, first, w.join(' '))
    const inTeam = tries.filter(x => x.length >= 2)
    const tag = words(m.team)[0] ?? m.team
    return [...new Set([...inTeam, ...inTeam.map(x => `${tag} ${x}`), m.name, `${m.team}/${m.name}`])].filter(x => x.length >= 2)
  }
  const steps = list.map(ladder)
  const at = list.map(() => 0)
  const label = (i: number) => (given[i] !== '' ? (given[i] as string) : steps[i]![Math.min(at[i]!, steps[i]!.length - 1)]!)
  for (let round = 0; round < 20; round++) {
    const count = new Map<string, number>()
    list.forEach((_, i) => count.set(label(i).toLowerCase(), (count.get(label(i).toLowerCase()) ?? 0) + 1))
    // only the automatic labels move; a short name the person gave stays where it is
    const clash = list.map((_, i) => given[i] === '' && (count.get(label(i).toLowerCase()) ?? 0) > 1)
    if (!clash.some(Boolean)) break
    clash.forEach((c, i) => c && (at[i] = at[i]! + 1))
  }
  const same = new Map<string, number>()
  given.forEach(g => g !== '' && same.set(g.toLowerCase(), (same.get(g.toLowerCase()) ?? 0) + 1))
  return new Map(
    list.map((m, i) => [`${m.team}|${m.name}`, { label: label(i), auto: given[i] === '', dup: given[i] !== '' && (same.get(given[i]!.toLowerCase()) ?? 0) > 1 }]),
  )
}

/** Just the labels, for a caller that does not need to know which are automatic. */
export function chartLabels(list: Labelled[]): Map<string, string> {
  return new Map([...chartLabelInfo(list)].map(([k, v]) => [k, v.label]))
}
