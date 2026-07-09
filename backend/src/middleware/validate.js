/**
 * Validation helpers.
 *
 * Validation failures respond with HTTP 422 in the same shape the frontend
 * already parses (FastAPI style): { detail: [{ loc, msg, type }] }.
 * See src/lib/apiUtils.js in the frontend — it reads errBody.detail[0].msg.
 */

export class ValidationError extends Error {
  constructor(msg, loc = []) {
    super(msg);
    this.name = 'ValidationError';
    this.status = 422;
    this.detail = [{ loc: ['body', ...loc], msg, type: 'value_error' }];
  }
}

export const assert = (condition, msg, loc) => {
  if (!condition) throw new ValidationError(msg, loc);
};

export const asInt = (value, name, { min, max } = {}) => {
  const n = typeof value === 'string' ? parseInt(value, 10) : value;
  assert(Number.isFinite(n) && Number.isInteger(Number(n)), `${name} must be an integer`, [name]);
  if (min !== undefined) assert(n >= min, `${name} must be >= ${min}`, [name]);
  if (max !== undefined) assert(n <= max, `${name} must be <= ${max}`, [name]);
  return n;
};

export const asString = (value, name, { required = true, maxLength = 500 } = {}) => {
  if (value === undefined || value === null || value === '') {
    assert(!required, `${name} is required`, [name]);
    return '';
  }
  assert(typeof value === 'string', `${name} must be a string`, [name]);
  assert(value.length <= maxLength, `${name} is too long`, [name]);
  return value.trim();
};
