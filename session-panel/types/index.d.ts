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
  sources: { instructions: boolean; skills: boolean; docs: boolean; github: boolean }
}

/** One line in the Assumptions panel: a declared ASSUMPTION line, or a flagged undeclared edit. */
export type Assumption = {
  id: number
  text: string
  turn: number
  kind: 'declared' | 'flagged'
  path?: string
  status: 'open' | 'confirmed' | 'wrong'
  /** when it was added, ms since the epoch */
  at: number
  resolvedAt?: number
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
    }
  }
}
