import type { EngineInterface } from 'claude-code'

import type { Prefs } from '../types'
import { SOURCE_CAP, enhancePrompt, parseEnhanced } from './logic'

type Hooked = EngineInterface

export type Outcome =
  | { kind: 'off' }
  | { kind: 'empty' }
  | { kind: 'failed'; reason: string }
  | { kind: 'filled'; prompt: string; notes: string[] }

/** A digest of one file, reused while its mtime is unchanged. */
async function cached($: Hooked, path: string, load: () => Promise<string>): Promise<string> {
  const st = await $.fs.stat(path)
  const key = `digest:${path}`
  const hit = (await $.store.get(key)) as { mtimeMs: number; text: string } | undefined
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.text
  const text = (await load()).slice(0, SOURCE_CAP)
  await $.store.set(key, { mtimeMs: st.mtimeMs, text })
  return text
}

/** Reads the enabled sources. A source that fails is skipped, never fatal. */
export async function buildContext($: Hooked, sources: Prefs['sources']): Promise<{ text: string; used: string[] }> {
  const parts: string[] = []
  const used: string[] = []
  const add = (label: string, body: string) => {
    if (body.trim() === '') return
    parts.push(`## ${label}\n${body}`)
    used.push(label)
  }
  // Forward slashes only: a backslash inside a template literal is dropped (the probe found this).
  const home = ((await $.env.get('USERPROFILE')) ?? '').replace(/\\/g, '/')

  if (sources.instructions) {
    try {
      const globalPath = `${home}/.claude/CLAUDE.md`
      if (await $.fs.exists(globalPath)) add('Global CLAUDE.md', await cached($, globalPath, () => $.fs.read(globalPath)))
    } catch {
      // skipped
    }
    try {
      for (const f of await $.fs.ancestors({ names: ['CLAUDE.md', 'AGENTS.md'] })) {
        add(`${f.name} (${f.dir})`, await cached($, `${f.dir}/${f.name}`, async () => f.content))
      }
    } catch {
      // skipped
    }
  }

  if (sources.skills) {
    try {
      const names = (await $.fs.list(`${home}/.claude/skills`)).filter(e => e.kind === 'dir').map(e => e.name)
      add('Skills', names.join(', '))
    } catch {
      // skipped
    }
    try {
      const names = (await $.fs.list('.claude/skills')).filter(e => e.kind === 'dir').map(e => e.name)
      add('Project skills', names.join(', '))
    } catch {
      // no project skills folder: ENOENT counts as zero
    }
  }

  if (sources.docs) {
    for (const path of ['CONTEXT.md', 'PRD.md', 'GLOSSARY.md']) {
      try {
        if (await $.fs.exists(path)) add(path, await cached($, path, () => $.fs.read(path)))
      } catch {
        // skipped
      }
    }
    try {
      const adrs = (await $.fs.list('docs/adr')).filter(e => e.kind === 'file').map(e => e.name)
      add('ADRs', adrs.join(', '))
    } catch {
      // no ADR folder
    }
  }

  if (sources.github) {
    try {
      const r = await $.process.run(['gh', 'issue', 'list', '--limit', '10'])
      if (r.exitCode === 0) add('GitHub issues (gh)', r.stdout.slice(0, SOURCE_CAP))
    } catch {
      // gh missing or not signed in
    }
  }

  return { text: parts.join('\n\n'), used }
}

/** Fork first, so the model sees the conversation. Fall back to a plain completion with the chosen model. */
async function ask($: Hooked, prefs: Prefs, prompt: string): Promise<string | null> {
  const fork = await $.model.fork({ prompt })
  if (fork.isAnswered) return fork.text
  if (fork.reason !== 'nothing-to-fork') return null
  const plain = await $.model.complete({ model: prefs.model, prompt })
  return plain.isAnswered ? plain.text : null
}

/** Enhances a draft. Asks up to three questions first when the draft is vague. */
export async function enhance($: Hooked, draft: string, prefs: Prefs): Promise<Outcome> {
  if (!prefs.enhancerOn) return { kind: 'off' }
  if (draft.trim() === '') return { kind: 'empty' }
  const context = await buildContext($, prefs.sources)
  const first = await ask($, prefs, enhancePrompt(draft, context.text, []))
  let parsed = first === null ? null : parseEnhanced(first)
  if (!parsed) return { kind: 'failed', reason: 'the model gave no usable reply' }

  const answers: string[] = []
  for (const q of parsed.questions) {
    answers.push(`${q.question} ${await $.ui.ask(q.question, q.options)}`)
  }
  if (answers.length > 0) {
    const second = await ask($, prefs, enhancePrompt(draft, context.text, answers))
    parsed = second === null ? null : parseEnhanced(second)
    if (!parsed) return { kind: 'failed', reason: 'the model gave no usable reply after the questions' }
  }
  if (parsed.prompt === '') return { kind: 'failed', reason: 'the model returned no prompt' }

  const notes = [...parsed.notes]
  if (context.used.length > 0 && notes.length < 4) notes.push(`Sources: ${context.used.join(', ')}`)
  return { kind: 'filled', prompt: parsed.prompt, notes }
}
