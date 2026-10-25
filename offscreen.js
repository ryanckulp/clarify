// Hidden document that owns the captured tab streams and the audio graphs.
// Chrome mutes a tab while it's being captured, so whatever we connect to
// ctx.destination is what the user hears.

import { createChain, DEFAULTS } from './audio-chain.js';

const sessions = new Map(); // tabId -> { ctx, stream, chain }
let settings = { ...DEFAULTS };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  handle(msg).then(sendResponse, (err) => sendResponse({ error: err?.message || String(err) }));
  return true;
});

async function handle(msg) {
  switch (msg.type) {
    case 'start':
      return start(msg.tabId, msg.streamId, msg.settings);
    case 'stop':
      await stop(msg.tabId);
      return { ok: true, remaining: sessions.size };
    case 'settings':
      settings = { ...settings, ...msg.settings };
      await Promise.all([...sessions.values()].map((s) => s.chain.update(settings)));
      return { ok: true };
    case 'levels': {
      const s = sessions.get(msg.tabId);
      if (!s) return null;
      const l = s.chain.levels();
      const deviceMs = ((s.ctx.baseLatency || 0) + (s.ctx.outputLatency || 0)) * 1000;
      return { ...l, latencyMs: Math.round(l.latencyMs + deviceMs) };
    }
    case 'list':
      return [...sessions.keys()];
    default:
      return { error: `unknown message ${msg.type}` };
  }
}

async function start(tabId, streamId, initial) {
  if (initial) settings = { ...settings, ...initial };
  if (sessions.has(tabId)) return { ok: true };

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  try {
    const chain = await createChain(ctx, settings);
    ctx.createMediaStreamSource(stream).connect(chain.input);
    chain.output.connect(ctx.destination);
    await ctx.resume();

    // Fires when the tab closes or capture is otherwise torn down.
    stream.getAudioTracks()[0]?.addEventListener('ended', async () => {
      await stop(tabId);
      chrome.runtime.sendMessage({ target: 'sw', type: 'ended', tabId }).catch(() => {});
    });

    sessions.set(tabId, { ctx, stream, chain });
    return { ok: true };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
    throw err;
  }
}

async function stop(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  sessions.delete(tabId);
  s.chain.destroy();
  s.stream.getTracks().forEach((t) => t.stop()); // un-mutes the tab
  await s.ctx.close();
}
