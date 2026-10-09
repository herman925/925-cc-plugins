// Bundled encryption for cross-device work (#78; design and spike on #74). Pure (no $), so a test can call it. The
// cryptography is the vendored noble code in ./vendor (see its README): nothing is installed on any device.
//
//  - Sealed messages: sealed to a recipient's X25519 public key. Each seal makes a fresh (ephemeral) key pair; the
//    shared secret goes through HKDF-SHA256 (salt = ephemeral public key + recipient public key, a fixed info string)
//    to a key for XChaCha20-Poly1305 with a random 24-byte nonce. Only the recipient's private key opens it.
//      text: tobox1:<base64url( ephemeral public key 32 | nonce 24 | ciphertext + tag 16 )>
//  - The join bundle: home's Tailcat address and a random enrolment secret (any JSON value here), locked with a key
//    that Argon2id derives from the passphrase the person chooses. One copy-pasteable line:
//      text: tobundle1:<base64url( m u32 KiB | t u8 | p u8 | salt 16 | nonce 24 | ciphertext + tag 16 | check 4 )>
//    m, t, p and the salt travel in the header, so the cost can be raised later and old bundles still open. The
//    header (and the prefix) is the cipher's associated data: changing a parameter breaks the tag. `check` is the
//    first 4 bytes of SHA-256 over everything before it. It is not a secret and stops nobody on purpose; it tells a
//    bundle damaged in copying apart from a wrong passphrase.
//  - Unlocking costs about 2-2.6 s on Herman's PC at the default (64 MiB, t=3, p=4: RFC 9106's second option; the
//    spike on #74). lockBundle/unlockBundle run it synchronously: it cannot be interrupted and blocks every other
//    hook of this plugin meanwhile (measured on #78). lockBundleAsync/unlockBundleAsync run noble's argon2idAsync,
//    which yields every 10 ms (about 3.4 s in all) so the plugin's other hooks answer within ~30 ms. It yields through
//    setTimeout, which hooks have on this build although the API types say they have no timers (undocumented): where
//    setTimeout is missing, the async pair falls back to the synchronous path. Either way a bundle that asks for more
//    than MAX_KDF is refused before any work: a hook's budget is 10 s.
//  - Every failure is a CryptoError with a `fault` a caller can branch on. Nothing ever returns unauthenticated bytes.

import { x25519 } from './vendor/noble-curves/ed25519.js'
import { xchacha20poly1305 } from './vendor/noble-ciphers/chacha.js'
import { hkdf } from './vendor/noble-hashes/hkdf.js'
import { sha256 } from './vendor/noble-hashes/sha2.js'
import { argon2id, argon2idAsync } from './vendor/noble-hashes/argon2.js'

export const BOX_PREFIX = 'tobox1:'
export const BUNDLE_PREFIX = 'tobundle1:'
const SEAL_INFO = 'team-orchestrator/seal/v1'

/** Argon2id cost: m in KiB, t passes, p lanes. */
export type KdfParams = { m: number; t: number; p: number }
/** What a new bundle is locked with (#74's spike: about 2-2.6 s here, 4x under a hook's 10 s budget). */
export const DEFAULT_KDF: Readonly<KdfParams> = Object.freeze({ m: 64 * 1024, t: 3, p: 4 })
/** The most an unlock will do: 256 MiB took about 10 s here, which is a hook's whole budget. */
export const MAX_KDF = Object.freeze({ m: 256 * 1024, t: 10, p: 16, work: 3 * 128 * 1024 })

export type CryptoFault =
  /** the text is not a sealed message or a join bundle at all */
  | 'not-sealed' | 'not-bundle'
  /** a later format this copy of the mod does not know */
  | 'unknown-version'
  /** a sealed message that does not open: altered, or sealed to another key */
  | 'refused'
  /** a bundle whose check fails: altered or cut off while copying */
  | 'damaged'
  /** the check passes but the bundle does not open: the passphrase is wrong (or the bundle was altered on purpose) */
  | 'wrong-passphrase'
  /** a bundle asking for more work than MAX_KDF */
  | 'too-costly'
  /** a key, passphrase or parameter that is not usable */
  | 'bad-input'

export class CryptoError extends Error {
  constructor(readonly fault: CryptoFault, message: string) {
    super(message)
    this.name = 'CryptoError'
  }
}
const fail = (fault: CryptoFault, message: string): never => { throw new CryptoError(fault, message) }

// ── bytes and text ──

const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64U_AT = new Map([...B64U].map((c, i) => [c, i]))

/** Base64url without padding. */
export function toB64u(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6))
    for (let j = 0; j < chars; j++) out += B64U[(n >> (18 - 6 * j)) & 63]
  }
  return out
}

/** Base64url back to bytes; undefined for anything that is not strict base64url. */
export function fromB64u(text: string): Uint8Array | undefined {
  if (text.length % 4 === 1) return undefined
  const out = new Uint8Array(Math.floor((text.length * 6) / 8))
  let bits = 0, acc = 0, at = 0
  for (const c of text) {
    const v = B64U_AT.get(c)
    if (v === undefined) return undefined
    acc = ((acc << 6) | v) & 0xffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at++] = (acc >> bits) & 0xff
    }
  }
  // the leftover bits of the last character must be zero, or two texts would decode alike
  return acc & ((1 << bits) - 1) ? undefined : out
}

const utf8 = (s: string) => new TextEncoder().encode(s)
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) (out.set(p, at), (at += p.length))
  return out
}
/** A source of random bytes: crypto's, unless a test passes a fixed one. */
export type Random = (n: number) => Uint8Array
const random: Random = n => crypto.getRandomValues(new Uint8Array(n))
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])
/** a key given as bytes or base64url text, checked to be 32 bytes */
const key32 = (k: Uint8Array | string, what: string) => {
  const bytes = typeof k === 'string' ? fromB64u(k) : k
  return bytes?.length === 32 ? bytes : fail('bad-input', `The ${what} is not a 32-byte key.`)
}
/** a pasted block: line breaks and spaces from mail or chat are dropped */
const unwrap = (text: string) => text.replace(/\s+/g, '')

// ── sealed messages ──

export type KeyPair = {
  /** base64url, 32 bytes: safe to share */
  publicKey: string
  /** base64url, 32 bytes: never leaves the device's key store */
  privateKey: string
}

/** A new X25519 key pair. */
export function newKeyPair(): KeyPair {
  const sk = x25519.utils.randomSecretKey()
  return { publicKey: toB64u(x25519.getPublicKey(sk)), privateKey: toB64u(sk) }
}

/** The public key that belongs to a private key. */
export const publicKeyOf = (privateKey: Uint8Array | string): string => toB64u(x25519.getPublicKey(key32(privateKey, 'private key')))

const boxKey = (shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array) =>
  hkdf(sha256, shared, concat(ephPub, recipientPub), utf8(SEAL_INFO), 32)

/** Seal a message to a recipient's public key: `tobox1:…`. */
export function seal(recipientPub: Uint8Array | string, plaintext: Uint8Array | string): string {
  const pub = key32(recipientPub, 'recipient public key')
  const eph = x25519.utils.randomSecretKey()
  const ephPub = x25519.getPublicKey(eph)
  let shared: Uint8Array
  try {
    shared = x25519.getSharedSecret(eph, pub)
  } catch {
    // a low-order point gives an all-zero secret, which noble refuses
    return fail('bad-input', 'The recipient public key is not a usable X25519 key.')
  }
  const nonce = random(24)
  const body = typeof plaintext === 'string' ? utf8(plaintext) : plaintext
  const box = xchacha20poly1305(boxKey(shared, ephPub, pub), nonce, utf8(BOX_PREFIX)).encrypt(body)
  return BOX_PREFIX + toB64u(concat(ephPub, nonce, box))
}

/** Open a sealed message with the recipient's private key. Throws a CryptoError, never returns garbage. */
export function open(recipientPriv: Uint8Array | string, sealed: string): Uint8Array {
  const sk = key32(recipientPriv, 'private key')
  const text = unwrap(sealed)
  const version = /^tobox(\d+):/.exec(text)
  if (!version) return fail('not-sealed', 'This is not a sealed message.')
  if (version[0] !== BOX_PREFIX) return fail('unknown-version', `This message uses format ${version[1]}, which this version of the mod cannot open. Update it.`)
  const bytes = fromB64u(text.slice(BOX_PREFIX.length))
  if (!bytes || bytes.length < 32 + 24 + 16) return fail('refused', 'This sealed message is damaged.')
  const ephPub = bytes.subarray(0, 32), nonce = bytes.subarray(32, 56), box = bytes.subarray(56)
  try {
    const shared = x25519.getSharedSecret(sk, ephPub)
    return xchacha20poly1305(boxKey(shared, ephPub, x25519.getPublicKey(sk)), nonce, utf8(BOX_PREFIX)).decrypt(box)
  } catch {
    return fail('refused', 'This sealed message does not open: it was altered, or it was sealed to another key.')
  }
}

/** open(), read as UTF-8 text. */
export const openText = (recipientPriv: Uint8Array | string, sealed: string): string =>
  new TextDecoder().decode(open(recipientPriv, sealed))

// ── the join bundle ──

const HEADER = 4 + 1 + 1 + 16 + 24
const CHECK = 4

/** Unicode-normalised so the same passphrase typed on Windows and macOS gives the same key. */
const passBytes = (passphrase: string) =>
  passphrase.length ? utf8(passphrase.normalize('NFKC')) : fail('bad-input', 'The passphrase is empty.')

function checkKdf({ m, t, p }: KdfParams, locking: boolean): void {
  const whole = [m, t, p].every(Number.isSafeInteger)
  if (!whole || t < 1 || p < 1 || m < 8 * p || p > 255 || m > 0xffffffff || t > 255)
    fail(locking ? 'bad-input' : 'damaged', `Argon2id parameters m=${m}, t=${t}, p=${p} are not valid.`)
  if (m > MAX_KDF.m || t > MAX_KDF.t || p > MAX_KDF.p || m * t > MAX_KDF.work)
    fail(locking ? 'bad-input' : 'too-costly',
      `Argon2id m=${m} KiB, t=${t}, p=${p} is more work than this version of the mod will do (it could outrun a hook's 10 s budget).`)
}

const argonOpts = ({ m, t, p }: KdfParams) => ({ m, t, p, dkLen: 32, maxmem: MAX_KDF.m * 1024 + 1024 })
const derive = (passphrase: string, salt: Uint8Array, kdf: KdfParams) => argon2id(passBytes(passphrase), salt, argonOpts(kdf))
/** setTimeout is how noble's async Argon2id yields; it is undocumented in hooks, so without it this is derive() */
const deriveAsync = async (passphrase: string, salt: Uint8Array, kdf: KdfParams): Promise<Uint8Array> =>
  typeof (globalThis as { setTimeout?: unknown }).setTimeout === 'function'
    ? argon2idAsync(passBytes(passphrase), salt, { ...argonOpts(kdf), asyncTick: 10 })
    : derive(passphrase, salt, kdf)

/** Everything a lock needs but the key: checked parameters, fresh salt and nonce, the header and the JSON. */
function lockParts(payload: unknown, kdf: KdfParams, rand: Random) {
  checkKdf(kdf, true)
  const json = JSON.stringify(payload)
  if (json === undefined) fail('bad-input', 'The bundle payload is not a JSON value.')
  const salt = rand(16), nonce = rand(24)
  const header = new Uint8Array(HEADER)
  const view = new DataView(header.buffer)
  view.setUint32(0, kdf.m)
  view.setUint8(4, kdf.t)
  view.setUint8(5, kdf.p)
  header.set(salt, 6)
  header.set(nonce, 22)
  return { salt, nonce, header, plain: utf8(json!) }
}

function lockWith(key: Uint8Array, { nonce, header, plain }: ReturnType<typeof lockParts>): string {
  const body = concat(header, xchacha20poly1305(key, nonce, concat(utf8(BUNDLE_PREFIX), header)).encrypt(plain))
  return BUNDLE_PREFIX + toB64u(concat(body, sha256(body).subarray(0, CHECK)))
}

/** Lock a JSON value with a passphrase: one `tobundle1:…` line to copy to the other device. Costs one Argon2id run. */
export function lockBundle(payload: unknown, passphrase: string, kdf: KdfParams = DEFAULT_KDF, rand: Random = random): string {
  const parts = lockParts(payload, kdf, rand)
  return lockWith(derive(passphrase, parts.salt, kdf), parts)
}

/** lockBundle, yielding while Argon2id runs (see the top of this file); the same output for the same randomness. */
export async function lockBundleAsync(payload: unknown, passphrase: string, kdf: KdfParams = DEFAULT_KDF, rand: Random = random): Promise<string> {
  const parts = lockParts(payload, kdf, rand)
  return lockWith(await deriveAsync(passphrase, parts.salt, kdf), parts)
}

/** The header of a bundle, read without the passphrase (cheap): its Argon2id cost and salt. */
export function bundleHeader(text: string): KdfParams & { salt: Uint8Array } {
  const { kdf, salt } = parseBundle(text)
  return { ...kdf, salt }
}

function parseBundle(text: string) {
  const clean = unwrap(text)
  const version = /^tobundle(\d+):/.exec(clean)
  if (!version) return fail('not-bundle', 'This is not a join bundle: it should start with "tobundle".')
  if (version[0] !== BUNDLE_PREFIX) return fail('unknown-version', `This bundle uses format ${version[1]}, which this version of the mod cannot open. Update it.`)
  const bytes = fromB64u(clean.slice(BUNDLE_PREFIX.length))
  if (!bytes || bytes.length < HEADER + 16 + CHECK) return fail('damaged', 'This bundle is damaged or cut off. Copy it again, whole.')
  const body = bytes.subarray(0, bytes.length - CHECK)
  if (!sameBytes(sha256(body).subarray(0, CHECK), bytes.subarray(bytes.length - CHECK)))
    return fail('damaged', 'This bundle is damaged or cut off. Copy it again, whole.')
  const view = new DataView(body.buffer, body.byteOffset, HEADER)
  const kdf: KdfParams = { m: view.getUint32(0), t: view.getUint8(4), p: view.getUint8(5) }
  checkKdf(kdf, false)
  return { kdf, header: body.subarray(0, HEADER), salt: body.slice(6, 22), nonce: body.subarray(22, HEADER), box: body.subarray(HEADER) }
}

function unlockWith<T>(key: Uint8Array, { header, nonce, box }: ReturnType<typeof parseBundle>): T {
  let plain: Uint8Array
  try {
    plain = xchacha20poly1305(key, nonce, concat(utf8(BUNDLE_PREFIX), header)).decrypt(box)
  } catch {
    return fail('wrong-passphrase', 'The passphrase is wrong, or the bundle was altered.')
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    // authentic, so only a different program could have written it
    return fail('unknown-version', 'This bundle opened but its contents are not in a form this version of the mod reads.')
  }
}

/** Unlock a bundle with its passphrase, giving back the JSON value. Throws a CryptoError, never returns garbage. */
export function unlockBundle<T = unknown>(text: string, passphrase: string): T {
  const parts = parseBundle(text)
  return unlockWith<T>(derive(passphrase, parts.salt, parts.kdf), parts)
}

/** unlockBundle, yielding while Argon2id runs (see the top of this file). Rejects with the same CryptoErrors. */
export async function unlockBundleAsync<T = unknown>(text: string, passphrase: string): Promise<T> {
  const parts = parseBundle(text)
  return unlockWith<T>(await deriveAsync(passphrase, parts.salt, parts.kdf), parts)
}

// ── passphrase strength (a warning only; nothing is refused) ──

export type Strength = {
  /** 0 very weak … 4 strong */
  score: 0 | 1 | 2 | 3 | 4
  /** a rough, cautious estimate of the guesses needed, in bits */
  bits: number
  /** one short reason, for the meter's label */
  reason: string
  /** true below 3: show the warning */
  warn: boolean
}

const COMMON = new Set([
  'password', 'passw0rd', 'p@ssw0rd', 'password1', '123456', '1234567', '12345678', '123456789', '1234567890',
  'qwerty', 'qwertyuiop', 'asdfgh', 'abc123', '111111', '000000', 'letmein', 'iloveyou', 'admin', 'welcome',
  'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'master', 'shadow', 'superman', 'trustno1',
  'changeme', 'secret', 'opensesame', 'hello123', 'computer', 'whatever', 'starwars',
])

/** lower case, upper case, digits, the rest; with how many choices each adds per character */
const CLASSES: [RegExp, number][] = [[/\p{Ll}/u, 26], [/\p{Lu}/u, 26], [/\d/, 10], [/[^\p{L}\d]/u, 33]]

/** How hard a passphrase is to guess, for a meter. It only warns: the person may keep a weak one. */
export function passphraseStrength(passphrase: string): Strength {
  const p = passphrase.normalize('NFKC')
  const out = (bits: number, reason: string): Strength => {
    const score = bits >= 64 ? 4 : bits >= 44 ? 3 : bits >= 32 ? 2 : bits >= 20 ? 1 : 0
    return { score, bits: Math.round(bits), reason, warn: score < 3 }
  }
  if (!p) return out(0, 'Empty.')
  if (COMMON.has(p.toLowerCase().replace(/[\d!@#$%^&*.]+$/, '')) || COMMON.has(p.toLowerCase()))
    return out(0, 'A well-known password.')

  // several words: count each as about 11 bits (a word from a 2,000-word list), the cautious view
  const words = p.split(/[\s\-_.,]+/).filter(w => /\p{L}{2,}/u.test(w))
  if (words.length >= 3) {
    const bits = words.length * 11
    return out(bits, bits >= 44 ? `${words.length} words: good.` : 'Only 3 words: add one or two more.')
  }

  // otherwise by characters, not counting repeats or runs (aaaa, abcd, 4321)
  const chars = [...p]
  const used = CLASSES.filter(([r]) => r.test(p))
  const kinds = used.length
  const pool = used.reduce((n, [, size]) => n + size, 0)
  let counted = 0
  chars.forEach((c, i) => {
    const step = i ? c.codePointAt(0)! - chars[i - 1]!.codePointAt(0)! : 99
    if (step !== 0 && Math.abs(step) !== 1) counted++
  })
  const bits = counted * Math.log2(Math.max(pool, 10))
  const reason = chars.length < 10 ? `Short (${chars.length} characters): use 10 or more, or 4 words.`
    : counted < chars.length * 0.75 ? 'Repeats or runs of characters.'
      : kinds < 2 ? 'Only one kind of character: add words, digits or symbols.'
        : bits >= 44 ? 'Long and varied: good.' : 'Fair: a few more characters or words would help.'
  return out(chars.length < 10 ? Math.min(bits, 31) : bits, reason)
}
