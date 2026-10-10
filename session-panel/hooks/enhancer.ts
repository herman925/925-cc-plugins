import type { EnhancerState, Prefs } from '../types'
import { SOURCE_CAP, enhancePrompt, parseEnhanced, recentExcerpt } from './logic'

/**
 * What the enhancer needs from the engine. The band builds this from `$` in session-panel.tsx: `$` itself cannot be
 * passed across an import, so each call the enhancer makes is a plain function here.
 */
export type EnhancerIo = {
  home: () => Promise<string>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  mtime: (path: string) => Promise<number>
  list: (path: string) => Promise<Array<{ name: string; kind: string }>>
  ancestors: (names: string[]) => Promise<Array<{ dir: string; name: string; content: string }>>
  cacheGet: (key: string) => Promise<{ mtimeMs: number; text: string } | undefined>
  cacheSet: (key: string, value: { mtimeMs: number; text: string }) => Promise<void>
  gh: () => Promise<{ exitCode: number; stdout: string } | undefined>
  messages: () => Promise<Array<{ role: string; text: string }>>
  fork: (prompt: string) => Promise<{ isAnswered: true; text: string } | { isAnswered: false; reason: string }>
  complete: (model: string, prompt: string) => Promise<{ isAnswered: true; text: string } | { isAnswered: false }>
  askUser: (question: string, options: string[]) => Promise<string>
}

export type Outcome =
  | { kind: 'off' }
  | { kind: 'empty' }
  | { kind: 'failed'; reason: string }
  | { kind: 'filled'; prompt: string; notes: string[]; via: string }

/** A digest of one file, reused while its mtime is unchanged. */
async function cached(io: EnhancerIo, path: string, load: () => Promise<string>): Promise<string> {
  const mtimeMs = await io.mtime(path)
  const key = `digest:${path}`
  const hit = await io.cacheGet(key)
  if (hit && hit.mtimeMs === mtimeMs) return hit.text
  const text = (await load()).slice(0, SOURCE_CAP)
  await io.cacheSet(key, { mtimeMs, text })
  return text
}

/** Reads the enabled sources. A source that fails is skipped, never fatal. */
export async function buildContext(io: EnhancerIo, sources: Prefs['sources']): Promise<{ text: string; used: string[] }> {
  const parts: string[] = []
  const used: string[] = []
  const add = (label: string, body: string) => {
    if (body.trim() === '') return
    parts.push(`## ${label}\n${body}`)
    used.push(label)
  }
  // Forward slashes only: a backslash inside a template literal is dropped (the probe found this).
  const home = (await io.home()).replace(/\\/g, '/')

  if (sources.instructions) {
    try {
      const globalPath = `${home}/.claude/CLAUDE.md`
      if (await io.exists(globalPath)) add('Global CLAUDE.md', await cached(io, globalPath, () => io.read(globalPath)))
    } catch {
      // skipped
    }
    try {
      for (const f of await io.ancestors(['CLAUDE.md', 'AGENTS.md'])) {
        add(`${f.name} (${f.dir})`, await cached(io, `${f.dir}/${f.name}`, async () => f.content))
      }
    } catch {
      // skipped
    }
  }

  if (sources.skills) {
    try {
      const names = (await io.list(`${home}/.claude/skills`)).filter(e => e.kind === 'dir').map(e => e.name)
      add('Skills', names.join(', '))
    } catch {
      // skipped
    }
    try {
      const names = (await io.list('.claude/skills')).filter(e => e.kind === 'dir').map(e => e.name)
      add('Project skills', names.join(', '))
    } catch {
      // no project skills folder: ENOENT counts as zero
    }
  }

  if (sources.docs) {
    for (const path of ['CONTEXT.md', 'PRD.md', 'GLOSSARY.md']) {
      try {
        if (await io.exists(path)) add(path, await cached(io, path, () => io.read(path)))
      } catch {
        // skipped
      }
    }
    try {
      const adrs = (await io.list('docs/adr')).filter(e => e.kind === 'file').map(e => e.name)
      add('ADRs', adrs.join(', '))
    } catch {
      // no ADR folder
    }
  }

  if (sources.github) {
    try {
      const r = await io.gh()
      if (r && r.exitCode === 0) add('GitHub issues (gh)', r.stdout.slice(0, SOURCE_CAP))
    } catch {
      // gh missing or not signed in
    }
  }

  return { text: parts.join('\n\n'), used }
}

/** Reads the recent turns, or nothing when the chat route is the full chat. A failed read is no excerpt. */
async function messagesOrEmpty(io: EnhancerIo): Promise<Array<{ role: string; text: string }>> {
  try {
    return await io.messages()
  } catch {
    return []
  }
}

/**
 * One model answer. "recent" sends the docs and the last turns to complete() on the chosen model. "full" forks the
 * session (its own model and transcript), and falls back to complete() only when there is nothing to fork yet.
 */
async function answer(io: EnhancerIo, prefs: Prefs, draft: string, context: string, answers: string[]): Promise<{ text: string; via: string } | null> {
  if (prefs.chat === 'recent') {
    const prompt = enhancePrompt(draft, context, answers, recentExcerpt(await messagesOrEmpty(io)))
    const r = await io.complete(prefs.model, prompt)
    return r.isAnswered ? { text: r.text, via: `complete:${prefs.model}` } : null
  }
  const prompt = enhancePrompt(draft, context, answers)
  const fork = await io.fork(prompt)
  if (fork.isAnswered) return { text: fork.text, via: 'fork' }
  if (fork.reason !== 'nothing-to-fork') return null
  const plain = await io.complete(prefs.model, prompt)
  return plain.isAnswered ? { text: plain.text, via: `complete:${prefs.model}` } : null
}

/** Enhances a draft. Asks up to three questions first when the draft is vague. */
export async function enhance(io: EnhancerIo, draft: string, prefs: Prefs): Promise<Outcome> {
  if (!prefs.enhancerOn) return { kind: 'off' }
  if (draft.trim() === '') return { kind: 'empty' }
  const context = await buildContext(io, prefs.sources)
  const first = await answer(io, prefs, draft, context.text, [])
  let parsed = first === null ? null : parseEnhanced(first.text)
  if (!parsed) return { kind: 'failed', reason: 'the model gave no usable reply' }
  let via = first!.via

  const answers: string[] = []
  try {
    for (const q of parsed.questions) {
      answers.push(`${q.question} ${await io.askUser(q.question, q.options)}`)
    }
  } catch {
    // no picker in this session (for example `claude -p`): stop rather than guess the answers
    return { kind: 'failed', reason: 'it needs answers, and no picker is open in this session' }
  }
  if (answers.length > 0) {
    const second = await answer(io, prefs, draft, context.text, answers)
    parsed = second === null ? null : parseEnhanced(second.text)
    if (!parsed) return { kind: 'failed', reason: 'the model gave no usable reply after the questions' }
    via = second!.via
  }
  if (parsed.prompt === '') return { kind: 'failed', reason: 'the model returned no prompt' }

  const notes = [...parsed.notes]
  if (context.used.length > 0 && notes.length < 4) notes.push(`Sources: ${context.used.join(', ')}`)
  return { kind: 'filled', prompt: parsed.prompt, notes, via }
}

/** The defaults before the first-run setup has saved anything. */
export const DEFAULT_PREFS: Prefs = {
  enhancerOn: true,
  autoEnhance: false,
  model: 'haiku',
  chat: 'recent',
  sources: { instructions: true, skills: true, docs: true, github: false },
}

/** The enhancer's engine calls plus the band's box and state, as plain functions, so the actions can be tested. */
export type EnhancerDeps = EnhancerIo & {
  prefs: () => Promise<Prefs>
  state: () => Promise<EnhancerState>
  setState: (patch: Partial<EnhancerState>) => Promise<void>
  readBox: () => Promise<string>
  fillBox: (text: string) => Promise<void>
  submitBox: (text: string) => Promise<void>
  toast: (text: string) => void
}

const NO_DRAFT: Partial<EnhancerState> = { original: null, passText: null, notes: [] }

/**
 * Enhances a draft and fills the box with the result. The draft is the box, unless the caller passes one: the
 * auto-enhance hook passes the prompt being submitted, because that prompt is not in the box at that point.
 */
export async function runEnhance(d: EnhancerDeps, draft?: string): Promise<string> {
  const prefs = await d.prefs()
  if (!prefs.enhancerOn) return 'The enhancer is off. Open Settings to turn it on.'
  const text = draft ?? (await d.readBox())
  if (text.trim() === '') return 'The box is empty. Type a draft first.'
  await d.setState({ busy: true })
  try {
    const r = await enhance(d, text, prefs)
    if (r.kind !== 'filled') return r.kind === 'failed' ? `Enhancer: ${r.reason}.` : 'Nothing to enhance.'
    await d.setState({ original: text, passText: r.prompt, notes: r.notes })
    await d.fillBox(r.prompt)
    return 'Enhanced. Check the box, then Send.'
  } catch {
    return 'Enhancer: something went wrong. The box is unchanged.'
  } finally {
    await d.setState({ busy: false })
  }
}

export async function undoEnhance(d: EnhancerDeps): Promise<void> {
  const st = await d.state()
  if (st.original === null) return
  await d.fillBox(st.original)
  await d.setState(NO_DRAFT)
}

/** Sends the box as the person's own words. The enhanced text passes the submit hook once, so the draft is cleared after. */
export async function sendBox(d: EnhancerDeps): Promise<void> {
  const text = await d.readBox()
  if (text.trim() === '') {
    d.toast('The box is empty.')
    return
  }
  await d.submitBox(text)
  await d.setState(NO_DRAFT)
}
