import { PolicyError } from './errors.mjs';

export const EXCERPT_MAX_CHARS = 500;

const REDACTORS = [
  /[a-z][a-z0-9+.-]*:\/\/[^\s/]*:[^\s@/]+@[^\s]+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi,
  /\b(?:api[_-]?key|access[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*\S+/gi,
  /(^|\n)\s*[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\s*=\s*\S+/g,
];

export function credentialFreeExcerpt(text, max = EXCERPT_MAX_CHARS) {
  if (text == null) return '';
  if (typeof text !== 'string') {
    throw new PolicyError('excerpt_type', 'Task excerpt must be a string.');
  }
  let cleaned = text;
  for (const pattern of REDACTORS) cleaned = cleaned.replace(pattern, '[redacted]');
  const chars = Array.from(cleaned);
  if (chars.length <= max) return cleaned;
  return chars.slice(0, max).join('');
}

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(part => part && typeof part === 'object' && (part.type === 'text' || part.type === undefined) && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n');
}

export function taskTextFromRequest(data) {
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return textOfContent(messages[i].content);
  }
  return '';
}
