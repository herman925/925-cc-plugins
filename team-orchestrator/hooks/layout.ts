// The roster table's columns and the org chart's labels, from the members and the width alone: no $, no state,
// so a test can call them. Every cell is cut with "…" to its width and ends in one space, so nothing wraps and
// two values never touch.

export type Tier = 'wide' | 'medium' | 'narrow'
export type Col = { id: string; w: number; head: string }
export type ColumnPlan = { tier: Tier; nameW: number; cols: Col[]; buttons: boolean; total: number }

// "[x] " before the name, and "[ Open ][ Remove ]" after the cells
export const CHECK = 4
export const BUTTONS = 18

// Cells per tier, each width counting its trailing space. Measured sums: wide 58, medium 38, narrow 18; with the
// checkbox and the two buttons a row needs 80 / 60 / 22 cells plus the name.
const TIERS: { tier: Tier; cols: [string, number][]; buttons: boolean }[] = [
  { tier: 'wide', cols: [['STATUS', 11], ['CONTEXT', 16], ['MODEL', 14], ['EFFORT', 8], ['BRIEF', 9]], buttons: true },
  { tier: 'medium', cols: [['STATUS', 11], ['CONTEXT', 12], ['MODEL', 8], ['EFFORT', 7]], buttons: true },
  { tier: 'narrow', cols: [['STATUS', 2], ['CONTEXT', 5], ['MODEL', 7], ['EFFORT', 4]], buttons: false },
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
 * column toggles, applied on top of the tier; OPEN hides the buttons.
 */
export function columnPlan(rows: { prefix: string; name: string }[], width: number, hide: string[]): ColumnPlan {
  const want = Math.max(4, ...rows.map(r => r.prefix.length + r.name.length)) + 1
  for (const t of TIERS) {
    const cols = t.cols
      .filter(([id]) => !hide.includes(id))
      .map(([id, w]) => ({ id, w, head: id.length <= w - 1 ? id : (SHORT_HEAD[id] ?? '') }))
    const buttons = t.buttons && !hide.includes('OPEN')
    const fixed = CHECK + cols.reduce((a, c) => a + c.w, 0) + (buttons ? BUTTONS : 0)
    const room = width - fixed
    if (room < Math.min(want, NAME_ROOM) && t.tier !== 'narrow') continue
    const nameW = Math.max(NAME_MIN, Math.min(want, room))
    return { tier: t.tier, nameW, cols, buttons, total: fixed + nameW }
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
// The shortest label that tells each member apart: the name less the words its whole team shares at the front
// ("Hualong PC Worker A" in team Hualong -> "PC Worker A"), then the first label of a ladder no other member
// also gets: the last word ("CEO", "Workers"), the first word's initial and the last ("W5"), the rest, the whole
// name. A leading acronym stays in front ("PC Boss", "PC A"). Two characters at least.
const words = (s: string) => s.split(/[\s_-]+/).filter(w => w !== '')

export function chartLabels(list: { team: string; name: string }[]): Map<string, string> {
  const rests = new Map<string, string[]>()
  for (const team of new Set(list.map(m => m.team))) {
    const mine = list.filter(m => m.team === team)
    const ws = mine.map(m => words(m.name))
    let n = 0
    if (mine.length > 1) while (ws.every(w => w.length > n + 1 && w[n] === ws[0]![n])) n++
    // a team named like its members' common start ("Squad-Worker-1" in team Squad) counts as shared too
    const lead = words(team)
    if (n === 0 && ws.every(w => w.length > lead.length && lead.every((x, i) => w[i] === x))) n = lead.length
    mine.forEach((m, i) => rests.set(`${m.team}|${m.name}`, ws[i]!.slice(n)))
  }
  const ladder = (m: { team: string; name: string }): string[] => {
    const w = rests.get(`${m.team}|${m.name}`) ?? words(m.name)
    const last = w[w.length - 1] ?? m.name
    const first = w[0] ?? ''
    // a leading acronym ("PC") names a sub-group: keep it in front of the last word
    const acronym = w.length > 1 && /^[A-Z0-9]{2,}$/.test(first)
    const group = w.length > 1 ? (acronym ? `${first} ${last}` : `${first[0]}${last}`) : ''
    return (acronym ? [group, last] : [last, group]).concat([w.join(' '), m.name, `${m.team}/${m.name}`]).filter(x => x.length >= 2)
  }
  const steps = list.map(ladder)
  const at = list.map(() => 0)
  for (let round = 0; round < 6; round++) {
    const label = (i: number) => steps[i]![Math.min(at[i]!, steps[i]!.length - 1)]!
    const count = new Map<string, number>()
    list.forEach((_, i) => count.set(label(i), (count.get(label(i)) ?? 0) + 1))
    const clash = list.map((_, i) => (count.get(label(i)) ?? 0) > 1)
    if (!clash.some(Boolean)) break
    clash.forEach((c, i) => c && (at[i] = at[i]! + 1))
  }
  return new Map(list.map((m, i) => [`${m.team}|${m.name}`, steps[i]![Math.min(at[i]!, steps[i]!.length - 1)]!]))
}
