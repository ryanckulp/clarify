// Shared by the service worker, popup and audio engine.
export const DEFAULTS = Object.freeze({
  denoise: 'natural', // 'off' | 'natural' (GTCRN) | 'max' (RNNoise)
  level: true, // auto-level volume
  clarity: true, // presence boost around 3 kHz
  mono: false, // fold stereo to mono (hard-panned guests)
  boostDb: 0, // extra output gain, 0–12
});
