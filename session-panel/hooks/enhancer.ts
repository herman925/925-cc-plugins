import type { Prefs } from '../types'
import { SOURCE_CAP, enhancePrompt, parseEnhanced } from './logic'

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
  fork: (prompt: string) => Promise<{ isAnswered: true; text: string } | { isAnswered: false; reason: string }>
  complete: (model: string, prompt: string) => Promise<{ isAnswered: true; text: string } | { isAnswered: false }>
  askUser: (question: string, options: string[]) => Promise<string>
}

export type Outcome =
  | { kind: 'off' }
  | { kind: 'empty' }
  | { kind: 'failed'; reason: string }
  | { kind: 'filled'; prompt: string; notes: string[] }

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

/** Fork first, so the model sees the conversation. Fall back to a plain completion with the chosen model. */
async function ask(io: EnhancerIo, prefs: Prefs, prompt: string): Promise<string | null> {
  const fork = await io.fork(prompt)
  if (fork.isAnswered) return fork.text
  if (fork.reason !== 'nothing-to-fork') return null
  const plain = await io.complete(prefs.model, prompt)
  return plain.isAnswered ? plain.text : null
}

/** Enhances a draft. Asks up to three questions first when the draft is vague. */
export async function enhance(io: EnhancerIo, draft: string, prefs: Prefs): Promise<Outcome> {
  if (!prefs.enhancerOn) return { kind: 'off' }
  if (draft.trim() === '') return { kind: 'empty' }
  const context = await buildContext(io, prefs.sources)
  const first = await ask(io, prefs, enhancePrompt(draft, context.text, []))
  let parsed = first === null ? null : parseEnhanced(first)
  if (!parsed) return { kind: 'failed', reason: 'the model gave no usable reply' }

  const answers: string[] = []
  for (const q of parsed.questions) {
    answers.push(`${q.question} ${await io.askUser(q.question, q.options)}`)
  }
  if (answers.length > 0) {
    const second = await ask(io, prefs, enhancePrompt(draft, context.text, answers))
    parsed = second === null ? null : parseEnhanced(second)
    if (!parsed) return { kind: 'failed', reason: 'the model gave no usable reply after the questions' }
  }
  if (parsed.prompt === '') return { kind: 'failed', reason: 'the model returned no prompt' }

  const notes = [...parsed.notes]
  if (context.used.length > 0 && notes.length < 4) notes.push(`Sources: ${context.used.join(', ')}`)
  return { kind: 'filled', prompt: parsed.prompt, notes }
}

/** The defaults before the first-run setup has saved anything. */
export const DEFAULT_PREFS: Prefs = {
  enhancerOn: true,
  autoEnhance: false,
  model: 'haiku',
  sources: { instructions: true, skills: true, docs: true, github: false },
}
