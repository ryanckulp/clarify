// Slow automatic gain control for speech.
// Measures the incoming level over ~400 ms and steers gain toward a target,
// dropping gain quickly when things get loud and raising it slowly when they
// get quiet, so it doesn't pump up the noise floor between sentences.

const dbToLin = (db) => Math.pow(10, db / 20);

class ClarifyLeveler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.enabled = o.enabled ?? true;
    this.targetDb = o.targetDb ?? -20; // target RMS, dBFS
    this.maxGainDb = o.maxGainDb ?? 24;
    this.minGainDb = o.minGainDb ?? -12;
    this.gateDb = o.gateDb ?? -55; // below this we treat it as silence and hold gain

    this.blockSec = 128 / sampleRate;
    this.meanSquare = 0;
    this.recentDb = -120;
    this.gainDb = 0;
    this.prevLin = 1;
    this.signalSec = 0; // seconds of above-gate signal seen so far
    this.blocksSinceReport = 0;
    this.reportEvery = Math.max(1, Math.round(0.1 / this.blockSec));

    this.port.onmessage = ({ data }) => {
      for (const k of ['enabled', 'targetDb', 'maxGainDb', 'minGainDb', 'gateDb']) {
        if (k in data) this[k] = data[k];
      }
    };
  }

  coef(tauSec) {
    return Math.exp(-this.blockSec / tauSec);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const channels = Math.min(input.length, output.length);
    const len = input[0].length;

    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const x = input[c];
      for (let i = 0; i < len; i++) sum += x[i] * x[i];
    }
    const blockMs = sum / (channels * len);
    const a = this.coef(0.4);
    this.meanSquare = a * this.meanSquare + (1 - a) * blockMs;
    const levelDb = 10 * Math.log10(this.meanSquare + 1e-12);

    // Track recent speech level so pauses (which sit well below it) don't
    // count as "too quiet" and drag the noise floor up.
    if (levelDb > this.recentDb) this.recentDb = levelDb;
    else this.recentDb -= 3 * this.blockSec; // decay 3 dB/s
    const speaking = levelDb > this.gateDb && levelDb > this.recentDb - 10;

    let desired;
    let tau;
    if (!this.enabled) {
      desired = 0;
      tau = 0.05;
    } else if (speaking) {
      this.signalSec += this.blockSec;
      desired = Math.min(this.maxGainDb, Math.max(this.minGainDb, this.targetDb - levelDb));
      if (desired < this.gainDb) tau = 0.3; // get quieter fast
      else tau = this.signalSec < 3 ? 0.4 : 2.5; // lock on quickly at first, then drift slowly
    } else {
      desired = this.gainDb; // silence: hold
      tau = 1;
    }

    const g = this.coef(tau);
    this.gainDb = g * this.gainDb + (1 - g) * desired;
    const lin = dbToLin(this.gainDb);

    const step = (lin - this.prevLin) / len;
    for (let c = 0; c < channels; c++) {
      const x = input[c];
      const y = output[c];
      let gain = this.prevLin;
      for (let i = 0; i < len; i++) {
        gain += step;
        y[i] = x[i] * gain;
      }
    }
    this.prevLin = lin;

    if (++this.blocksSinceReport >= this.reportEvery) {
      this.blocksSinceReport = 0;
      this.port.postMessage({ gainDb: this.gainDb, levelDb });
    }
    return true;
  }
}

registerProcessor('clarify-leveler', ClarifyLeveler);
