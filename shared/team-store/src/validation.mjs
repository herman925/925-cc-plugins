import { refusal } from './errors.mjs';

export function text(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.length) || value.includes('\0') || !value.isWellFormed()) {
    throw refusal('STORE_INPUT_INVALID', `${field} must be ${allowEmpty ? 'a' : 'a nonempty'} NUL-free UTF-8 string.`, { field });
  }
  return value;
}

export function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw refusal('STORE_INPUT_INVALID', `${field} must be a safe integer between ${min} and ${max}.`, { field });
  }
  return value;
}

// pg returns BIGINT as decimal strings. Never silently round a database value.
export function databaseInteger(value, field, limits) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return integer(parsed, field, limits);
}

export function nextInteger(value, field) {
  return integer(integer(value, field) + 1, `${field} increment`, { min: 1 });
}

export function snapshot(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])));
}
