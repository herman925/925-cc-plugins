export type Form = {
  team: string
  fn: string
  levels: string
  fan: string
  /** '1' = a CEO above several teams, '0' = one team */
  ceo: string
  /** with a CEO: the team names, comma separated, one head each */
  groups: string
  // per-level defaults: model and effort for level 1 (head), 2, 3; 'default' = leave to claude
  m1: string
  e1: string
  m2: string
  e2: string
  m3: string
  e3: string
}
export type Member = {
  /** the team this session belongs to */
  team: string
  name: string
  /** the session's real name, what SendMessage addresses it by (defaults to name) */
  address?: string
  role: string
  level: number
  boss: string
  handle: string
  sessionId: string
  /** starting | working | idle | asking | offline | failed | <raw orca state> */
  state: string
  /** context used, percent, -1 unknown */
  ctx: number
  model: string
  effort: string
  sel: boolean
  note: string
  /** the one-time team briefing was sent */
  briefed: boolean
  /** the session answered "Noted" on screen */
  noted: boolean
}
export type Bulk = {
  prefix: string
  base: string
  /** none | 1 | 01 */
  numbering: string
  model: string
  effort: string
  msg: string
}
export type View = 'closed' | 'roster' | 'new'

declare module 'claude-code' {
  interface PluginState {
    'team-orchestrator': {
      form: Form
      members: Member[]
      note: string
      bulk: Bulk
      view: View
      teamName: string
      frame: number
      menu: string
    }
  }
}
