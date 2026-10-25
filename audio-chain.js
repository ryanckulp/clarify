// The processing chain, independent of how audio gets in or out:
//
//   input ─▶ high-pass 80 Hz ─▶ noise reduction ─▶ auto-level ─▶ presence EQ
//         ─▶ compressor ─▶ boost ─▶ limiter ─▶ output
//
// Used by offscreen.js for live tab audio; also runs in an OfflineAudioContext.

import {
  RnnoiseWorkletNode,
  GtcrnWorkletNode,
  loadRnnoise,
  loadGtcrn,
} from './vendor/noise-suppressor.js';
import { DEFAULTS } from './settings.js';

export { DEFAULTS };

// Processing latency per mode, measured by cross-correlating input and output
// (compressor + limiter lookahead, plus the denoiser's frame buffering).
export const LATENCY_MS = { off: 12, natural: 44, max: 33 };

const here = (p) => new URL(p, import.meta.url).href;

const WORKLETS = [
  './vendor/rnnoise-worklet.js',
  './vendor/gtcrn-worklet.js',
  './leveler-worklet.js',
];

const wasm = {};
function wasmFor(kind) {
  if (kind === 'max') {
    wasm.max ??= loadRnnoise({
      url: here('./vendor/rnnoise.wasm'),
      simdUrl: here('./vendor/rnnoise_simd.wasm'),
    });
  } else {
    wasm.natural ??= loadGtcrn({ url: here('./vendor/gtcrn.wasm') });
  }
  return wasm[kind];
}

async function makeDenoiser(ctx, kind) {
  const wasmBinary = await wasmFor(kind);
  const Node = kind === 'max' ? RnnoiseWorkletNode : GtcrnWorkletNode;
  return new Node(ctx, { maxChannels: 2, wasmBinary });
}

function rmsDb(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return 10 * Math.log10(sum / buf.length + 1e-12);
}

export async function createChain(ctx, initial = DEFAULTS) {
  if (ctx.sampleRate !== 48000) {
    throw new Error(`Noise reduction needs a 48 kHz AudioContext (got ${ctx.sampleRate}).`);
  }
  await Promise.all(WORKLETS.map((m) => ctx.audioWorklet.addModule(here(m))));

  const input = new GainNode(ctx, {
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 80, Q: 0.707 });
  const afterDenoise = new GainNode(ctx);
  const leveler = new AudioWorkletNode(ctx, 'clarify-leveler', {
    processorOptions: { enabled: initial.level },
  });
  const presence = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 3000, Q: 0.9, gain: 0 });
  const compressor = new DynamicsCompressorNode(ctx, {
    threshold: -18,
    knee: 8,
    ratio: 2.5,
    attack: 0.005,
    release: 0.2,
  });
  const boost = new GainNode(ctx);
  const limiter = new DynamicsCompressorNode(ctx, {
    threshold: -3,
    knee: 0,
    ratio: 20,
    attack: 0.001,
    release: 0.08,
  });
  const output = new GainNode(ctx);

  input.connect(highpass);
  afterDenoise.connect(leveler).connect(presence).connect(compressor);
  compressor.connect(boost).connect(limiter).connect(output);

  const preMeter = new AnalyserNode(ctx, { fftSize: 2048 });
  const postMeter = new AnalyserNode(ctx, { fftSize: 2048 });
  input.connect(preMeter);
  output.connect(postMeter);
  const meterBuf = new Float32Array(2048);

  let agc = { gainDb: 0, levelDb: -120 };
  leveler.port.onmessage = ({ data }) => (agc = data);

  let denoiser = null;
  let denoiseKind = null;
  let settings = { ...DEFAULTS };

  async function setDenoise(kind) {
    if (kind === denoiseKind) return;
    denoiseKind = kind;
    const next = kind === 'natural' || kind === 'max' ? await makeDenoiser(ctx, kind) : null;
    if (kind !== denoiseKind) {
      next?.destroy(); // superseded by a newer switch while loading
      return;
    }
    highpass.disconnect();
    if (denoiser) {
      denoiser.disconnect();
      denoiser.destroy();
    }
    denoiser = next;
    if (denoiser) highpass.connect(denoiser).connect(afterDenoise);
    else highpass.connect(afterDenoise);
  }

  async function update(partial) {
    settings = { ...settings, ...partial };
    const t = ctx.currentTime;
    input.channelCount = settings.mono ? 1 : 2;
    leveler.port.postMessage({ enabled: settings.level });
    presence.gain.setTargetAtTime(settings.clarity ? 4 : 0, t, 0.05);
    const boostDb = Math.min(12, Math.max(0, Number(settings.boostDb) || 0));
    boost.gain.setTargetAtTime(Math.pow(10, boostDb / 20), t, 0.05);
    await setDenoise(settings.denoise);
  }

  function levels() {
    return {
      inDb: rmsDb(preMeter, meterBuf),
      outDb: rmsDb(postMeter, meterBuf),
      gainDb: settings.level ? agc.gainDb : 0,
      latencyMs: LATENCY_MS[settings.denoise] ?? 0,
    };
  }

  function destroy() {
    for (const n of [input, highpass, afterDenoise, leveler, presence, compressor, boost, limiter, output]) {
      n.disconnect();
    }
    denoiser?.destroy();
    denoiser = null;
  }

  await update(initial);
  return { input, output, update, levels, destroy, get settings() { return settings; } };
}
