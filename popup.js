import { DEFAULTS } from './settings.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage({ target: 'sw', ...msg });

const HINTS = {
  off: 'Leveling and EQ only.',
  natural: 'Removes hiss, hum and room noise while keeping voices natural.',
  max: 'Removes the most noise. Can sound a bit gated on music or laughter.',
};

const UNCAPTURABLE = /^(chrome|chrome-extension|edge|about|devtools|view-source):|^https:\/\/chromewebstore\.google\.com/;

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let settings = { ...DEFAULTS };
let active = false;
let poll = null;

function friendly(message = '') {
  if (/active stream/i.test(message)) return 'This tab is already being captured (another extension or a screen share?).';
  if (/invoked|permission|activeTab/i.test(message)) return 'Click the Clarify toolbar icon on this tab, then try again.';
  if (/Chrome pages|cannot be captured/i.test(message)) return "Chrome doesn't allow capturing this page.";
  return message || 'Something went wrong.';
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

function renderActive() {
  $('toggle').textContent = active ? 'Stop cleaning' : 'Clean up this tab';
  $('toggle').classList.toggle('on', active);
  $('state').textContent = active ? 'Live' : 'Off';
  $('state').classList.toggle('live', active);
  $('meters').hidden = !active;
  clearInterval(poll);
  if (active) poll = setInterval(updateLevels, 100);
}

function renderSettings() {
  for (const b of document.querySelectorAll('[data-denoise]')) {
    b.setAttribute('aria-checked', String(b.dataset.denoise === settings.denoise));
  }
  $('denoiseHint').textContent = HINTS[settings.denoise] ?? '';
  for (const el of document.querySelectorAll('[data-setting]')) el.checked = !!settings[el.dataset.setting];
  $('boost').value = settings.boostDb;
  $('boostOut').textContent = `${settings.boostDb > 0 ? '+' : ''}${settings.boostDb} dB`;
}

const pct = (db) => `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
const fmt = (db) => (db < -59 ? '–' : `${Math.round(db)} dB`);

async function updateLevels() {
  const l = await send({ type: 'levels', tabId: tab.id }).catch(() => null);
  if (!l || l.error) return;
  $('inBar').style.width = pct(l.inDb);
  $('outBar').style.width = pct(l.outDb);
  $('inDb').textContent = fmt(l.inDb);
  $('outDb').textContent = fmt(l.outDb);
  const g = Math.round(l.gainDb);
  $('gain').textContent = settings.level ? `Auto gain ${g > 0 ? '+' : ''}${g} dB` : 'Auto gain off';
  $('latency').textContent = `~${l.latencyMs} ms delay`;
}

async function save(partial) {
  settings = { ...settings, ...partial };
  renderSettings();
  const res = await send({ type: 'settings', settings: partial });
  if (res?.error) showError(friendly(res.error));
}

async function toggle() {
  showError('');
  $('toggle').disabled = true;
  try {
    if (active) {
      await send({ type: 'stop', tabId: tab.id });
      active = false;
    } else {
      // Ask from the popup (the user just clicked us); the service worker retries if this fails.
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }).catch(() => undefined);
      const res = await send({ type: 'start', tabId: tab.id, streamId });
      if (res?.error) throw new Error(res.error);
      active = true;
    }
  } catch (err) {
    showError(friendly(err.message));
  } finally {
    $('toggle').disabled = false;
    renderActive();
  }
}

$('toggle').addEventListener('click', toggle);
for (const b of document.querySelectorAll('[data-denoise]')) {
  b.addEventListener('click', () => save({ denoise: b.dataset.denoise }));
}
for (const el of document.querySelectorAll('[data-setting]')) {
  el.addEventListener('change', () => save({ [el.dataset.setting]: el.checked }));
}
$('boost').addEventListener('input', (e) => save({ boostDb: Number(e.target.value) }));

const status = await send({ type: 'status', tabId: tab.id });
settings = { ...DEFAULTS, ...status?.settings };
active = !!status?.active;
renderSettings();
renderActive();

if (!active && tab.url && UNCAPTURABLE.test(tab.url)) {
  showError("Chrome doesn't allow capturing this page. Open a video tab and try again.");
} else {
  $('toggle').disabled = false;
}
