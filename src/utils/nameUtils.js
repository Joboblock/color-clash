/**
 * Name-related utility helpers.
 * Centralizes sanitization and validity reflection so multiple components (online/local inputs, hosting logic)
 * can share consistent behaviour.
 */

/** Maximum base length (not including numeric suffix logic handled elsewhere) */
export const PLAYER_NAME_LENGTH = 12;

/**
 * Sanitize a raw player name: collapse whitespace to underscore, strip non-alphanumerics/underscore,
 * and clamp to PLAYER_NAME_LENGTH.
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.replace(/\s+/g, '_');
  s = s.replace(/[^A-Za-z0-9_]/g, '');
  if (s.length > PLAYER_NAME_LENGTH) s = s.slice(0, PLAYER_NAME_LENGTH);
  return s;
}

/**
 * Reflect validity state on an input element: mark invalid if length is >0 and <3.
 * @param {HTMLInputElement} inputEl
 * @param {string} val
 */
export function reflectValidity(inputEl, val) {
  if (!inputEl) return;
  const tooShort = val.length > 0 && val.length < 3;
  if (tooShort) {
    inputEl.classList.add('invalid');
    inputEl.setAttribute('aria-invalid', 'true');
  } else {
    inputEl.classList.remove('invalid');
    inputEl.removeAttribute('aria-invalid');
  }
}
