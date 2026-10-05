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
/** the Actions menu of the roster: what it is doing for the ticked rows */
export type Act = {
  /** the team whose Team actions list is open, '' none */
  menu: string
  /** none | remove | rmteam | boss | bulk | add */
  kind: string
  /** the team card the open action (and its message) belongs to */
  to: string
  /** add: the boss; boss: the new boss */
  boss: string
  /** add: the picked tab's handle, and its role */
  handle: string
  role: string
  /** add: live tabs not on the roster, read when the action was picked */
  tabs: { handle: string; title: string }[]
  msg: string
}
export type View = 'closed' | 'roster' | 'new' | 'settings'
export type Settings = {
  /** stacked: team cards one under another | columns: side by side where the width allows | dock: the panel in a side pane */
  layout: 'stacked' | 'columns' | 'dock'
  /** show the live org chart */
  chart: boolean
  /** table columns hidden (STATUS, CONTEXT, MODEL, EFFORT, BRIEF); NAME always shows */
  hide: string[]
}

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
      settings: Settings
      act: Act
    }
  }
}
