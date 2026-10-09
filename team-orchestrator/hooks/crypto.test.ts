import { expect, test } from 'claude-code/testing'

import {
  BUNDLE_PREFIX, bundleHeader, CryptoError, DEFAULT_KDF, fromB64u, lockBundle, lockBundleAsync, newKeyPair, open,
  openText, passphraseStrength, publicKeyOf, seal, toB64u, unlockBundle, unlockBundleAsync,
} from './crypto'
import type { CryptoFault } from './crypto'
import { x25519 } from './vendor/noble-curves/ed25519.js'
import { argon2id } from './vendor/noble-hashes/argon2.js'
import { scrypt } from './vendor/noble-hashes/scrypt.js'
import { sha256 } from './vendor/noble-hashes/sha2.js'

const hex = (b: Uint8Array) => Array.from(b, v => v.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map(h => parseInt(h, 16)))
/** the fault a call throws, or 'none' */
const faultOf = (f: () => unknown): CryptoFault | 'none' => {
  try {
    f()
    return 'none'
  } catch (err) {
    expect(err).toBeInstanceOf(CryptoError)
    return (err as CryptoError).fault
  }
}
/** the fault a promise rejects with, or 'none' */
const faultOfAsync = async (f: () => Promise<unknown>): Promise<CryptoFault | 'none'> => {
  try {
    await f()
    return 'none'
  } catch (err) {
    expect(err).toBeInstanceOf(CryptoError)
    return (err as CryptoError).fault
  }
}
/** a block with its bytes changed by `edit`; `recheck` recomputes a bundle's copy check as an attacker would */
const altered = (text: string, prefix: string, edit: (b: Uint8Array) => void, recheck = false) => {
  const bytes = fromB64u(text.slice(prefix.length))!
  edit(bytes)
  if (recheck) bytes.set(sha256(bytes.subarray(0, bytes.length - 4)).subarray(0, 4), bytes.length - 4)
  return prefix + toB64u(bytes)
}
/** flip the low bit of byte `at` (negative: from the end) */
const flip = (b: Uint8Array, at: number) => { const i = at < 0 ? b.length + at : at; b[i] = b[i]! ^ 1 }
// cheap Argon2id for the tests that are not about cost
const QUICK = { m: 8 * 1024, t: 1, p: 1 }
const PAYLOAD = { address: 'home-pc.tail1234.ts.net:4417', secret: 'Zq3v8kM2nYpX7rTw', at: 1791532800000 }

// ── the vendored primitives: known-answer vectors ──

test('x25519 matches RFC 7748 6.1', () => {
  const sk = unhex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a')
  expect(hex(x25519.getPublicKey(sk))).toBe('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a')
  expect(publicKeyOf(sk)).toBe(toB64u(unhex('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a')))
})

test('argon2id matches RFC 9106 5.3', () => {
  const tag = argon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
    m: 32, t: 3, p: 4, dkLen: 32, key: new Uint8Array(8).fill(3), personalization: new Uint8Array(12).fill(4),
  })
  expect(hex(tag)).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659')
})

test('scrypt matches RFC 7914 12', () => {
  expect(hex(scrypt('password', 'NaCl', { N: 1024, r: 8, p: 16, dkLen: 64 })).slice(0, 32))
    .toBe('fdbabe1c9d3472007856e7190d01e9fe')
})

test('base64url round-trips every length and refuses anything not strict', () => {
  for (let n = 0; n < 40; n++) {
    const bytes = crypto.getRandomValues(new Uint8Array(n))
    const text = toB64u(bytes)
    expect(text).toMatch(/^[A-Za-z0-9_-]*$/)
    expect(hex(fromB64u(text)!)).toBe(hex(bytes))
  }
  expect(toB64u(unhex('fbff'))).toBe('-_8')
  expect([fromB64u('ab+c'), fromB64u('abc='), fromB64u('a'), fromB64u('-_9')]).toEqual([undefined, undefined, undefined, undefined])
})

// ── sealed messages ──

test('seal/open round-trips text and 4 KB of bytes, and each seal is different', () => {
  const { publicKey, privateKey } = newKeyPair()
  expect([fromB64u(publicKey)!.length, fromB64u(privateKey)!.length, publicKeyOf(privateKey)]).toEqual([32, 32, publicKey])
  const text = '{"from":"away","say":"hello 你好"}'
  const a = seal(publicKey, text), b = seal(publicKey, text)
  expect(a.startsWith('tobox1:')).toBe(true)
  expect(a).not.toBe(b)
  expect([openText(privateKey, a), openText(privateKey, b)]).toEqual([text, text])

  const bytes = crypto.getRandomValues(new Uint8Array(4096))
  const box = seal(fromB64u(publicKey)!, bytes)
  expect(hex(open(fromB64u(privateKey)!, box))).toBe(hex(bytes))
  // 32 ephemeral key + 24 nonce + 4096 + 16 tag
  expect(fromB64u(box.slice(7))!.length).toBe(4168)
})

test('a sealed message that was altered, cut, or sealed to another key is refused, never garbage', () => {
  const me = newKeyPair(), other = newKeyPair()
  const box = seal(me.publicKey, 'the enrolment secret')
  // a flipped bit in each part: ephemeral key, nonce, ciphertext, tag
  for (const at of [0, 40, 60, -1]) {
    const bad = altered(box, 'tobox1:', b => flip(b, at))
    expect(faultOf(() => open(me.privateKey, bad))).toBe('refused')
  }
  expect(faultOf(() => open(other.privateKey, box))).toBe('refused')
  expect(faultOf(() => open(me.privateKey, box.slice(0, 60)))).toBe('refused')
  expect(faultOf(() => open(me.privateKey, box + '!'))).toBe('refused')
  expect(faultOf(() => open(me.privateKey, 'tobox2:' + box.slice(7)))).toBe('unknown-version')
  expect(faultOf(() => open(me.privateKey, 'hello'))).toBe('not-sealed')
  expect(faultOf(() => open('short', box))).toBe('bad-input')
  expect(faultOf(() => seal(new Uint8Array(31), 'x'))).toBe('bad-input')
  // a low-order point (all zeros) is no key at all
  expect(faultOf(() => seal(new Uint8Array(32), 'x'))).toBe('bad-input')
  // still opens untouched, and a pasted copy broken over lines opens too
  expect(openText(me.privateKey, box.replace(/(.{40})/g, '$1\n  '))).toBe('the enrolment secret')
})

// ── the join bundle ──

test('bundle round-trips at the default cost, and unlock finishes in under 6 s', { timeoutMs: 60_000 }, () => {
  const text = lockBundle(PAYLOAD, 'correct horse battery staple')
  expect(text.startsWith(BUNDLE_PREFIX)).toBe(true)
  expect(text).toMatch(/^tobundle1:[A-Za-z0-9_-]+$/)
  // about 2-2.5 s on Herman's PC (#74's spike); a hook's budget is 10 s, so fail well before that
  const t0 = performance.now()
  expect(unlockBundle(text, 'correct horse battery staple')).toEqual(PAYLOAD)
  expect(performance.now() - t0).toBeLessThan(6_000)
})

test('the header carries m, t, p and a fresh salt, readable without the passphrase', () => {
  expect(DEFAULT_KDF).toEqual({ m: 65536, t: 3, p: 4 })
  const kdf = { m: 9 * 1024, t: 2, p: 3 }
  const a = lockBundle(PAYLOAD, 'pass phrase', kdf), b = lockBundle(PAYLOAD, 'pass phrase', kdf)
  const ha = bundleHeader(a), hb = bundleHeader(b)
  expect([ha.m, ha.t, ha.p, ha.salt.length]).toEqual([9216, 2, 3, 16])
  expect(hex(ha.salt)).not.toBe(hex(hb.salt))
  // a bundle at other parameters still opens: they are read from its header
  expect(unlockBundle(a, 'pass phrase')).toEqual(PAYLOAD)
})

test('a wrong passphrase fails cleanly', () => {
  const text = lockBundle(PAYLOAD, 'river otter lantern 42', QUICK)
  for (const guess of ['river otter lantern 43', 'River otter lantern 42', 'x', ' river otter lantern 42'])
    expect(faultOf(() => unlockBundle(text, guess))).toBe('wrong-passphrase')
  expect(faultOf(() => unlockBundle(text, ''))).toBe('bad-input')
  expect(faultOf(() => lockBundle(PAYLOAD, '', QUICK))).toBe('bad-input')
})

test('a tampered bundle is refused: damaged in copying, altered on purpose, or asking for too much work', () => {
  const text = lockBundle(PAYLOAD, 'pass phrase', QUICK)
  const P = BUNDLE_PREFIX
  // a changed byte anywhere, or a cut-off copy: the copy check catches it before any work
  for (const at of [0, 4, 10, 30, 50, -6, -1])
    expect(faultOf(() => unlockBundle(altered(text, P, b => flip(b, at)), 'pass phrase'))).toBe('damaged')
  expect(faultOf(() => unlockBundle(text.slice(0, -5), 'pass phrase'))).toBe('damaged')
  expect(faultOf(() => unlockBundle(text.slice(0, 30), 'pass phrase'))).toBe('damaged')
  expect(faultOf(() => unlockBundle(text + 'A', 'pass phrase'))).toBe('damaged')
  // altered with the check recomputed: the cipher's tag refuses it (salt, nonce, ciphertext; or t, which is in the AAD)
  for (const at of [10, 30, 50, -6])
    expect(faultOf(() => unlockBundle(altered(text, P, b => flip(b, at), true), 'pass phrase')))
      .toBe('wrong-passphrase')
  expect(faultOf(() => unlockBundle(altered(text, P, b => { b[4] = 2 }, true), 'pass phrase'))).toBe('wrong-passphrase')
  // a header asking for 4 GiB is refused at once, with no work done
  const t0 = performance.now()
  expect(faultOf(() => unlockBundle(altered(text, P, b => { b.set([0xff, 0xff, 0xff, 0xf0], 0) }, true), 'pass phrase'))).toBe('too-costly')
  expect(faultOf(() => unlockBundle(altered(text, P, b => { b[4] = 200 }, true), 'pass phrase'))).toBe('too-costly')
  expect(faultOf(() => unlockBundle(altered(text, P, b => { b[5] = 0 }, true), 'pass phrase'))).toBe('damaged')
  expect(performance.now() - t0).toBeLessThan(500)
  // the original still opens
  expect(unlockBundle(text, 'pass phrase')).toEqual(PAYLOAD)
})

test('a bundle of an unknown version, or not a bundle at all, says so', () => {
  const text = lockBundle(PAYLOAD, 'pass phrase', QUICK)
  expect(faultOf(() => unlockBundle('tobundle2:' + text.slice(BUNDLE_PREFIX.length), 'pass phrase'))).toBe('unknown-version')
  const err = (() => { try { unlockBundle('tobundle2:abc', 'x') } catch (e) { return e as CryptoError } })()!
  expect(err.message).toContain('format 2')
  expect(faultOf(() => unlockBundle('hello there', 'pass phrase'))).toBe('not-bundle')
  expect(faultOf(() => unlockBundle(seal(newKeyPair().publicKey, 'x'), 'pass phrase'))).toBe('not-bundle')
})

test('a bundle pasted with line breaks and spaces unlocks, and the passphrase is Unicode-normalised', () => {
  const composed = 'café au lait sous la pluie', decomposed = 'café au lait sous la pluie'
  const text = lockBundle(PAYLOAD, composed, QUICK)
  const pasted = '  ' + text.replace(/(.{32})/g, '$1\r\n') + '\n'
  expect(unlockBundle(pasted, decomposed)).toEqual(PAYLOAD)
  expect(faultOf(() => lockBundle(undefined, 'pass phrase', QUICK))).toBe('bad-input')
  expect(faultOf(() => lockBundle(PAYLOAD, 'pass phrase', { m: 512 * 1024, t: 3, p: 4 }))).toBe('bad-input')
  expect(faultOf(() => lockBundle(PAYLOAD, 'pass phrase', { m: 4, t: 1, p: 1 }))).toBe('bad-input')
})

// ── the async pair (yields while Argon2id runs) ──

/** the same bytes on every run, so a sync and an async lock can be compared byte for byte */
const seeded = () => {
  let n = 0
  return (len: number) => Uint8Array.from({ length: len }, () => (n++ * 37 + 11) & 0xff)
}

test('the async pair round-trips, and gives byte-identical bundles to the sync pair for the same salt', async () => {
  expect(typeof (globalThis as { setTimeout?: unknown }).setTimeout).toBe('function')
  const text = await lockBundleAsync(PAYLOAD, 'pass phrase', QUICK)
  expect(await unlockBundleAsync(text, 'pass phrase')).toEqual(PAYLOAD)
  // either way across
  expect(unlockBundle(text, 'pass phrase')).toEqual(PAYLOAD)
  expect(await unlockBundleAsync(lockBundle(PAYLOAD, 'pass phrase', QUICK), 'pass phrase')).toEqual(PAYLOAD)
  // same salt and nonce: the same line, at a cheap cost and at the default
  expect(await lockBundleAsync(PAYLOAD, 'pass phrase', QUICK, seeded())).toBe(lockBundle(PAYLOAD, 'pass phrase', QUICK, seeded()))
  // and it does yield: setTimeout is called while Argon2id runs
  const g = globalThis as { setTimeout?: unknown }
  const real = g.setTimeout as (...args: unknown[]) => unknown
  let yields = 0
  const kdf = { m: 16 * 1024, t: 2, p: 4 }
  let yielded: string
  try {
    g.setTimeout = (...args: unknown[]) => (yields++, real(...args))
    yielded = await lockBundleAsync(PAYLOAD, 'pass phrase', kdf, seeded())
  } finally {
    g.setTimeout = real
  }
  expect(yields).toBeGreaterThan(0)
  expect(yielded).toBe(lockBundle(PAYLOAD, 'pass phrase', kdf, seeded()))
})

test('without setTimeout the async pair falls back to the sync path, with the same output', async () => {
  const g = globalThis as { setTimeout?: unknown }
  const saved = g.setTimeout
  try {
    g.setTimeout = undefined
    expect(typeof g.setTimeout).toBe('undefined')
    const text = await lockBundleAsync(PAYLOAD, 'pass phrase', QUICK, seeded())
    expect(text).toBe(lockBundle(PAYLOAD, 'pass phrase', QUICK, seeded()))
    expect(await unlockBundleAsync(text, 'pass phrase')).toEqual(PAYLOAD)
    expect(await faultOfAsync(() => unlockBundleAsync(text, 'pass Phrase'))).toBe('wrong-passphrase')
  } finally {
    g.setTimeout = saved
  }
})

test('the async pair fails with the same faults as the sync pair', async () => {
  const text = lockBundle(PAYLOAD, 'river otter lantern 42', QUICK)
  const P = BUNDLE_PREFIX
  const cases: [string, string][] = [
    [text, 'river otter lantern 43'],
    [text, ''],
    [altered(text, P, b => flip(b, 30)), 'river otter lantern 42'],
    [altered(text, P, b => flip(b, 30), true), 'river otter lantern 42'],
    [altered(text, P, b => { b.set([0xff, 0xff, 0xff, 0xf0], 0) }, true), 'river otter lantern 42'],
    ['tobundle2:' + text.slice(P.length), 'river otter lantern 42'],
    ['hello', 'river otter lantern 42'],
  ]
  const sync = cases.map(([t, pass]) => faultOf(() => unlockBundle(t, pass)))
  expect(sync).toEqual(['wrong-passphrase', 'bad-input', 'damaged', 'wrong-passphrase', 'too-costly', 'unknown-version', 'not-bundle'])
  const async = []
  for (const [t, pass] of cases) async.push(await faultOfAsync(() => unlockBundleAsync(t, pass)))
  expect(async).toEqual(sync)
  expect(await faultOfAsync(() => lockBundleAsync(PAYLOAD, '', QUICK))).toBe(faultOf(() => lockBundle(PAYLOAD, '', QUICK)))
  expect(await faultOfAsync(() => lockBundleAsync(undefined, 'x', QUICK))).toBe('bad-input')
})

// ── passphrase strength ──

test('passphrase strength scores and explains, and only warns', () => {
  const s = (p: string) => passphraseStrength(p)
  expect([s('').score, s('').warn]).toEqual([0, true])
  expect(s('password').reason).toBe('A well-known password.')
  expect(s('Password123!').score).toBe(0)
  expect(s('k9#Tq').reason).toContain('Short')
  expect(s('k9#Tq').score).toBeLessThan(2)
  expect(s('aaaaaaaaaaaaaaaa').reason).toBe('Repeats or runs of characters.')
  expect(s('abcdefghijklmnop').warn).toBe(true)
  expect(s('lanternotter').reason).toContain('one kind')
  expect([s('river otter lantern').score, s('river otter lantern').reason]).toEqual([2, 'Only 3 words: add one or two more.'])
  expect([s('correct horse battery staple').score, s('correct horse battery staple').warn]).toEqual([3, false])
  expect(s('correct-horse-battery-staple-violin-moon').score).toBe(4)
  expect(s('vR7#qLp2!xZe9@Wm').score).toBe(4)
  expect(s('vR7#qLp2!xZe9@Wm').reason).toBe('Long and varied: good.')
  for (const p of ['', 'a', 'password', 'correct horse battery staple', 'vR7#qLp2!xZe9@Wm']) {
    const r = s(p)
    expect(r.warn).toBe(r.score < 3)
    expect(r.reason.length).toBeLessThan(70)
  }
})
