// Service worker: owns the offscreen document's lifecycle, tab capture IDs,
// settings storage and the toolbar badge. The popup talks only to this.

import { DEFAULTS } from './settings.js';

const OFFSCREEN_URL = 'offscreen.html';
let creating = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Process tab audio live to reduce noise and level volume.',
    })
    .finally(() => (creating = null));
  await creating;
}

const toOffscreen = (msg) => chrome.runtime.sendMessage({ target: 'offscreen', ...msg });

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...settings };
}

async function activeTabs() {
  if (!(await hasOffscreen())) return [];
  return (await toOffscreen({ type: 'list' })) || [];
}

async function setBadge(tabId, on) {
  try {
    await chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' });
    if (on) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#E8A33D' });
      await chrome.action.setBadgeTextColor?.({ tabId, color: '#1B1712' });
    }
  } catch {
    // tab is gone
  }
}

async function closeOffscreenIfIdle() {
  if ((await activeTabs()).length === 0 && (await hasOffscreen())) {
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}

async function startTab(tabId, streamId) {
  streamId ??= await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  const res = await toOffscreen({ type: 'start', tabId, streamId, settings: await getSettings() });
  if (res?.error) {
    await closeOffscreenIfIdle();
    throw new Error(res.error);
  }
  await setBadge(tabId, true);
}

async function stopTab(tabId) {
  if (await hasOffscreen()) await toOffscreen({ type: 'stop', tabId });
  await setBadge(tabId, false);
  await closeOffscreenIfIdle();
}

async function handle(msg) {
  switch (msg.type) {
    case 'status':
      return { active: (await activeTabs()).includes(msg.tabId), settings: await getSettings() };
    case 'start':
      await startTab(msg.tabId, msg.streamId);
      return { ok: true };
    case 'stop':
      await stopTab(msg.tabId);
      return { ok: true };
    case 'settings': {
      const settings = { ...(await getSettings()), ...msg.settings };
      await chrome.storage.local.set({ settings });
      if (await hasOffscreen()) await toOffscreen({ type: 'settings', settings });
      return { ok: true, settings };
    }
    case 'levels':
      return (await hasOffscreen()) ? toOffscreen({ type: 'levels', tabId: msg.tabId }) : null;
    case 'ended': // capture died (tab closed, etc.)
      await setBadge(msg.tabId, false);
      await closeOffscreenIfIdle();
      return { ok: true };
    default:
      return { error: `unknown message ${msg.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'sw') return;
  handle(msg).then(sendResponse, (err) => sendResponse({ error: err?.message || String(err) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-clarify' || !tab?.id) return;
  try {
    if ((await activeTabs()).includes(tab.id)) await stopTab(tab.id);
    else await startTab(tab.id);
  } catch (err) {
    console.warn('Clarify:', err);
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' }).catch(() => {});
  }
});

// Tab-specific badges reset on navigation; capture doesn't, so put it back.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === 'loading' && (await activeTabs()).includes(tabId)) setBadge(tabId, true);
});
