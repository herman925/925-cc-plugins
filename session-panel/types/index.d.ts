export type CleanTaskStatus = 'done' | 'active' | 'upcoming'

export type CleanTask = {
  id: string
  name: string
  status: CleanTaskStatus
  /** Highest percent reported so far, 0 to 100. Never goes down. */
  percent: number
  /** True once Claude reported a percent for this step. */
  hasReported: boolean
  /** The eased value the meter draws; moves toward percent on each tick. */
  shown: number
}

export type CleanPhase = 'idle' | 'working' | 'needs-you' | 'stuck' | 'stopped' | 'done'

export type CleanQuestion = { question: string; options: string[] }

export type CleanChecklist = {
  title: string
  phase: CleanPhase
  tasks: CleanTask[]
  needsYouReason: string
  stuckReason: string
  startedAt: number
  finishedAt: number
  isCollapsed: boolean
  /** Counts jobs, so a slow job name from an old job is ignored. */
  jobId: number
  /** True once plan_steps or a to-do list made a real plan for this job. */
  hasPlan: boolean
  /** The plain verb line under the current step, "" for none. */
  action: string
  /** The ask_choices question being shown, or null. */
  question: CleanQuestion | null
  /** Distinct files changed by Edit, Write or NotebookEdit during the job. */
  changedFiles: string[]
  /** Consecutive failed tool calls. */
  failStreak: number
  /** True once the bell rang for the current Needs-you event. */
  isBelled: boolean
  /** The eased whole-job percent the bar style draws; never goes down. */
  bar: number
}

/** Enhancer choices, saved in the store and changed in Settings. */
export type Prefs = {
  enhancerOn: boolean
  autoEnhance: boolean
  model: string
  chat: 'recent' | 'full'
  assumptions: boolean
  flagUndeclared: boolean
  /** the decision step: a pointer digest of the assumptions worth reading this turn (#91) */
  decide: boolean
  /** the fallback threshold the keep rule uses when decide.json names none for this turn */
  decideThreshold: number
  /** the TypeSafe Jev pass: a second, opt-in opinion on the shortlist (#91 slice 2) */
  jev: boolean
  sources: { instructions: boolean; skills: boolean; docs: boolean; github: boolean }
}

/** One line in the Assumptions panel: a declared ASSUMPTION line, or a flagged undeclared edit. */
export type Assumption = {
  id: number
  text: string
  turn: number
  kind: 'declared' | 'flagged'
  /** flagged: the first edited file, relative to the project root */
  path?: string
  /** flagged: every edited file of the turn, relative to the project root */
  paths?: string[]
  status: 'open' | 'confirmed' | 'wrong'
  /** when it was added, ms since the epoch */
  at: number
  resolvedAt?: number
  /** the session that added it; a file can hold entries of sessions that closed */
  sessionId: string
}

/** Per-session assumption state: the list (newest first), the turn in progress, and the panel's open state. */
export type AssumptionTrack = {
  entries: Assumption[]
  seq: number
  turnNo: number
  runningTurnId: string
  turnDeclared: boolean
  turnEdits: string[]
  open: boolean
  /** this session's file, absolute with forward slashes; '' until located, or when the file could not be read */
  file: string
  sessionId: string
  /** the session's name, or its session id when it has no name */
  member: string
  /** the project root, forward slashes, '' until located */
  root: string
  /** the old id files already merged into this file, by file name */
  merged: string[]
  /** old ids renumbered by a merge: old id -> the id the entry has here */
  idMap: Record<string, number>
  /** the OS, for case rules; '' until located */
  os: 'windows' | 'macos' | 'linux' | ''
  /** true once the 'another session' toast has shown for this session */
  warned: boolean
}

/** What the band's enhancer holds for the draft: the text before it was enhanced, and the notes. */
export type EnhancerState = { original: string | null; passText: string | null; notes: string[]; busy: boolean }

export type CleanStyle = 'checklist' | 'bars'

/** A finished job kept as a dismissible bar. */
export type CleanFinished = { id: string; title: string; seconds: number; steps: string[] }

declare module 'claude-code' {
  interface PluginState {
    'session-panel': {
      sessionPanelEnabled: boolean
      askChoicesEnabled: boolean
      settingsOpen: boolean
      checklist: CleanChecklist
      tick: number
      viewStyle: CleanStyle
      finished: CleanFinished[]
      prefs: Prefs
      enhancer: EnhancerState
      openGroups: string[]
      gateDenied: number
      assumptionTrack: AssumptionTrack
      /** the plugin's manifest version, read once per load; '' when it cannot be read */
      version: string
      /** the assumption row whose full text is open, or null */
      assumptionExpanded: number | null
      /** the rows printed while the assumptions reveal runs, or null when it has finished */
      assumptionReveal: number | null
      /** the table columns the reader has hidden: id, turn, text, path, at */
      hiddenColumns: string[]
      /** the text of the last prompt the person sent; the decision step reads the turn's wording from here */
      submittedText: string
    }
  }
}
