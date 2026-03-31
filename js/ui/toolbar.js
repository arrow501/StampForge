// Header bar and progress overlay management.

import $ from 'jquery';
import { S } from '../state.js';

let _toastTimer = null;

// ── Export button state ──────────────────────────────────────────────────────

export function setExportEnabled(enabled) {
  $('#btn-export').prop('disabled', !enabled);
}

// ── Progress overlay ─────────────────────────────────────────────────────────

export function showProgress(msg = 'Working…', pct = 0) {
  S.exportActive = true;
  $('#progress-overlay').removeClass('hidden');
  $('#progress-msg').text(msg);
  setProgress(pct);
}

export function setProgress(pct, msg) {
  $('#progress-bar').css('width', Math.round(pct) + '%');
  if (msg != null) $('#progress-msg').text(msg);
}

export function hideProgress() {
  S.exportActive = false;
  $('#progress-overlay').addClass('hidden');
}

// ── Toast notifications ──────────────────────────────────────────────────────

/**
 * Show a short toast message.
 * @param {string} msg
 * @param {'info'|'error'} [type]
 * @param {number} [duration]  ms
 */
export function toast(msg, type = 'info', duration = 2800) {
  const $t = $('#toast');
  $t.text(msg)
    .css('border-color', type === 'error' ? 'var(--red)' : 'var(--border)')
    .addClass('show');

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => $t.removeClass('show'), duration);
}

// ── Section collapse toggle ──────────────────────────────────────────────────

export function initSectionToggles() {
  $(document).on('click', '.section-header', function () {
    $(this).closest('.section').toggleClass('collapsed');
  });
}
