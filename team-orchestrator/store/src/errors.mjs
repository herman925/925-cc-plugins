export class StoreError extends Error {
  constructor(code, message, details = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'StoreError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export const refusal = (code, message, details, cause) => new StoreError(code, message, details, cause);

export function isRetryable(engine, error) {
  if (engine === 'postgres') return ['40001', '40P01'].includes(error.code);
  const primary = Number(error.errcode) & 255;
  return [5, 6].includes(primary) || ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error.code);
}

export function isConstraint(engine, error) {
  return engine === 'postgres' ? /^23/.test(error.code ?? '') : (Number(error.errcode) & 255) === 19;
}
