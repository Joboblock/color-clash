// generalUtils.js
// Combined former utilities.js + nameUtils.js (color helpers, sizing, URL, name sanitization, tips)
// Keep exports stable; update all imports to point here.

import { PLAYER_NAME_LENGTH } from '../config/index.js';

// Color helpers -----------------------------------------------------------
export function mixTowardGray(color, gray = 128, factor = 0.5) {
  if (typeof gray !== 'number' || isNaN(gray)) gray = 128;
  gray = Math.max(0, Math.min(255, Math.round(gray)));
  if (typeof factor !== 'number' || isNaN(factor)) factor = 0.5;
  factor = Math.max(0, Math.min(1, factor));
  const { r, g, b } = cssColorToRgb(color);
  const mix = (c) => Math.round((1 - factor) * c + factor * gray);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function cssColorToRgb(color) {
  if (!color || typeof color !== 'string') return { r: 0, g: 0, b: 0 };
  const c = color.trim();
  if (c.startsWith('#')) return hexToRgb(c);
  const m = c.match(/rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (m) {
    const r = Math.max(0, Math.min(255, parseInt(m[1], 10)));
    const g = Math.max(0, Math.min(255, parseInt(m[2], 10)));
    const b = Math.max(0, Math.min(255, parseInt(m[3], 10)));
    return { r, g, b };
  }
  return { r: 0, g: 0, b: 0 };
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const bigint = parseInt(full, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

// URL helpers -------------------------------------------------------------
export function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

// Grid / game sizing helpers ---------------------------------------------
export function recommendedGridSize(p) {
  if (p <= 2) return 3;
  if (p <= 4) return 4;
  if (p === 5) return 5;
  return 6; // 6-8 players
}

export function defaultGridSizeForPlayers(p) {
  return Math.max(3, (parseInt(p, 10) || 0) + 3);
}

export function clampPlayers(n, maxPlayers) {
  const v = Math.max(2, Math.min(maxPlayers, Math.floor(n) || 2));
  return v;
}

// Name utilities ----------------------------------------------------------
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.replace(/\s/g, '_');
  s = s.replace(/[^A-Za-z0-9_]/g, '');
  if (s.length > PLAYER_NAME_LENGTH) s = s.slice(0, PLAYER_NAME_LENGTH);
  return s;
}

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

// Tips helpers ------------------------------------------------------------
export function getDeviceTips(isMobile = null) {
  const mobile = (isMobile !== null) ? !!isMobile : (typeof navigator !== 'undefined' && (
    (navigator.userAgentData && navigator.userAgentData.mobile === true) ||
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer:coarse)').matches) ||
    (navigator.maxTouchPoints > 1)
  ));
  const tips = [
    { text: 'Tip: You can also set <code>?players=\u003Cn\u003E&size=\u003Cn\u003E</code> in the URL.', weight: 1, html: true },
    { text: 'Tip: Grid size defaults to a recommended value but can be adjusted manually.', weight: 2 },
    { text: 'Tip: Use Practice mode to observe AI behavior and learn strategies.', weight: 1 },
    { text: 'Tip: <a href="https://joboblock.github.io" target="_blank">joboblock.github.io</a> redirects to this game.', weight: 2, html: true },
    { text: 'Tip: Give this project a <a href="https://github.com/Joboblock/color-clash" target="_blank">Star</a> to support development!', weight: 2, html: true },
    { text: 'Tip: This is a rare message.', weight: 0.1 },
    { text: 'Tip: Praise the Raute, embrace the Raute!', weight: 0.1 }
  ];
  if (mobile) tips.push({ text: 'Tip: Double-tap outside the grid to toggle fullscreen on mobile.', weight: 3 });
  else tips.push({ text: 'Tip: Use WASD or Arrow keys to move between menu controls and grid cells.', weight: 2 });
  return tips;
}

export function pickWeightedTip(list) {
  let total = 0;
  for (const t of list) total += (typeof t.weight === 'number' ? t.weight : 1);
  let roll = Math.random() * total;
  for (const t of list) {
    roll -= (typeof t.weight === 'number' ? t.weight : 1);
    if (roll <= 0) return t;
  }
  return list[list.length - 1];
}

export default {
  mixTowardGray,
  cssColorToRgb,
  hexToRgb,
  getQueryParam,
  recommendedGridSize,
  defaultGridSizeForPlayers,
  clampPlayers,
  sanitizeName,
  reflectValidity,
  getDeviceTips,
  pickWeightedTip
};