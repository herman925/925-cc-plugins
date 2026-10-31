import { createHash } from 'node:crypto';
import { PolicyError } from './errors.mjs';
import { validatePolicy } from './schema.mjs';

const SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|ghp_[A-Za-z0-9]{20,})\b/i;
const URL_VALUE = /[a-z][a-z0-9+.-]*:\/\//i;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function policyHash(policy) {
  const validated = validatePolicy(policy);
  return `sha256:${createHash('sha256').update(canonicalJson(validated)).digest('hex')}`;
}

export function createDraft(policy, { savedAt = null } = {}) {
  const validated = validatePolicy(policy);
  if (savedAt !== null && (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt)))) {
    throw new PolicyError('apply_shape', 'saved_at must be an ISO-8601 timestamp when set.');
  }
  return {
    status: 'draft',
    project_id: validated.project_id,
    policy: validated,
    saved_at: savedAt,
  };
}

function assertLabel(appliedBy) {
  if (typeof appliedBy !== 'string' || appliedBy.trim() === '' || appliedBy.length > 128) {
    throw new PolicyError('apply_shape', 'applied_by must be a short label. Do not pass a gateway token.');
  }
  if (SECRET_VALUE.test(appliedBy) || URL_VALUE.test(appliedBy) || /key|token|secret|password/i.test(appliedBy)) {
    throw new PolicyError('policy_secret', 'applied_by must be a label, not a credential.');
  }
}

export function applyDraft(draft, { appliedBy, appliedAt, previous = null } = {}) {
  if (!draft || draft.status !== 'draft' || !draft.policy) {
    throw new PolicyError('apply_shape', 'Apply requires a Draft record. Live Apply HTTP is not part of M1.');
  }
  const policy = validatePolicy(draft.policy);
  if (draft.project_id !== policy.project_id) {
    throw new PolicyError('apply_shape', 'Draft project_id does not match policy.project_id.');
  }
  assertLabel(appliedBy);
  if (typeof appliedAt !== 'string' || Number.isNaN(Date.parse(appliedAt))) {
    throw new PolicyError('apply_shape', 'applied_at must be an ISO-8601 timestamp.');
  }
  const previousRevision = previous?.revision ?? 0;
  if (!Number.isInteger(previousRevision) || previousRevision < 0) {
    throw new PolicyError('apply_shape', 'previous revision must be a non-negative integer.');
  }
  if (previous && (previous.status !== 'applied' || previous.project_id !== policy.project_id)) {
    throw new PolicyError('apply_shape', 'previous record must be an Applied record for the same project.');
  }
  return {
    status: 'applied',
    project_id: policy.project_id,
    revision: previousRevision + 1,
    policy_hash: policyHash(policy),
    applied_at: appliedAt,
    applied_by: appliedBy,
    policy,
  };
}

function snapshot(record) {
  return structuredClone(record);
}

export function createMemoryGateway() {
  const records = new Map();
  return {
    apply(draft, meta) {
      const storedPrevious = records.get(draft.project_id) ?? null;
      const applied = applyDraft(draft, {
        ...meta,
        previous: storedPrevious ? snapshot(storedPrevious) : null,
      });
      const stored = snapshot(applied);
      records.set(stored.project_id, stored);
      return snapshot(stored);
    },
    read(projectId) {
      const stored = records.get(projectId);
      return stored ? snapshot(stored) : null;
    },
  };
}
