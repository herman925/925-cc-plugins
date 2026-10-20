import type { Member } from '../types'

/** A status report from the member, never proof of OS/process/file cleanup. */
export type CleanupReport = {
  status: 'reported-clean' | 'reported-incomplete' | 'unverified'
  verified: false
}

const names = (m: Member) => [m.address, m.name].filter((x): x is string => !!x).map(x => x.toLowerCase())
const bareTo = (to: string) => to.replace(/\s*\[[^\]]*\]\s*$/, '').trim().toLowerCase()
export function reportsTo(me: Member, list: Member[], to: string): boolean {
  const boss = list.find(m => m.name === me.boss && m.team === me.team) ?? list.find(m => m.name === me.boss)
  return me.boss !== 'user' && !!boss && names(boss).includes(bareTo(to))
}

/** Message body from a peer envelope, or the original text for a normal SendMessage. */
export const bodyOf = (text: string) => (text.match(/<cross-session-message[^>]*>([\s\S]*?)<\/cross-session-message>/)?.[1] ?? text).trim()
export const senderOf = (text: string) => text.match(/from-name="([^"]+)"/)?.[1]

/** Parse only an explicit Cleanup: field. General words such as "done" or "clean" are never enough. */
export function parseCleanupReport(text: string): CleanupReport | undefined {
  const body = bodyOf(text)
  const match = /(?:^|[\n.]\s*)(?:cleanup status|cleanup|housekeeping)\s*[:=]\s*(clean|incomplete|failed|unverified)\b/i.exec(body)
  if (!match) return undefined
  const answer = match[1]!.toLowerCase()
  if (answer === 'unverified') return { status: 'unverified', verified: false }
  if (answer !== 'clean') return { status: 'reported-incomplete', verified: false }
  const rest = body.slice(match.index + match[0].length)
  if (/\b(?:not clean|incomplete|failed|unverified|still running|still exists|remain(?:s|ing)?|left|kept|retained|pending)\b|\b[1-9]\d*\s+(?:owned\s+)?(?:leftover\s+)?(?:files?|processes?|resources?)\b/i.test(rest))
    return { status: 'reported-incomplete', verified: false }
  return { status: 'reported-clean', verified: false }
}

/** Only the team top or a session that is not a member polls Orca. */
export const shouldPoll = (me: { boss?: string } | undefined) => !me || me.boss === 'user'
