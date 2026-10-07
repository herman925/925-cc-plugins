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

export type CleanStyle = 'checklist' | 'bars'

/** A finished job kept as a dismissible bar. */
export type CleanFinished = { id: string; title: string; seconds: number }

declare module 'claude-code' {
  interface PluginState {
    'clean-view': {
      cleanViewEnabled: boolean
      checklist: CleanChecklist
      tick: number
      viewStyle: CleanStyle
      finished: CleanFinished[]
    }
  }
}
