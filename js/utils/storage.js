// localStorage persistence with debounce.
// Only stamps palette + global settings are persisted.
// Position overrides are ephemeral (session only).

import { S } from '../state.js';

const KEY = 'stampforge_v2';
let _timer = null;

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.stampSize    != null) S.stampSize    = saved.stampSize;
    if (saved.stampOpacity != null) S.stampOpacity = saved.stampOpacity;
    if (saved.autoPlace)            Object.assign(S.autoPlace, saved.autoPlace);
    // Stamps are restored separately after ImageBitmaps are re-created
    return saved.stamps ?? [];
  } catch (_) {
    return [];
  }
}

export function saveSettings() {
  clearTimeout(_timer);
  _timer = setTimeout(_persist, 800);
}

function _persist() {
  try {
    const stamps = S.stamps.map(st => ({
      id:             st.id,
      name:           st.name,
      dataUrl:        st.dataUrl,
      defaultEnabled: st.defaultEnabled,
    }));
    localStorage.setItem(KEY, JSON.stringify({
      stampSize:    S.stampSize,
      stampOpacity: S.stampOpacity,
      autoPlace:    S.autoPlace,
      stamps,
    }));
  } catch (_) { /* quota exceeded etc */ }
}
