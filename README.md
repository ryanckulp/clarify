# Clarify — voice cleanup for any tab

Live noise reduction and volume leveling for podcasts and talking-head videos.
It works on the stream as it plays (no downloading), on YouTube or any other site.

## Install

1. Unzip this folder somewhere permanent.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `clarify` folder.
4. Pin Clarify to the toolbar. On a video tab, click the icon and press **Clean up this tab**.
   You can also toggle it with **Alt+Shift+C**; change the shortcut at `chrome://extensions/shortcuts`.

Requires Chrome 116 or newer.

## What it does

```
tab audio ─▶ high-pass 80 Hz ─▶ noise reduction ─▶ auto-level ─▶ voice clarity EQ
          ─▶ compressor ─▶ boost ─▶ limiter ─▶ your speakers
```

| Control | What it does |
|---|---|
| Noise reduction · **Natural** | GTCRN neural denoiser. Cleanest-sounding voices. Default. |
| Noise reduction · **Max** | RNNoise. Removes the most noise; can sound gated on music or laughter. |
| **Auto-level volume** | Slow gain control that brings speech to roughly YouTube loudness (about −15 dBFS RMS), up to +24 dB. It holds gain during pauses so it doesn't pump up the noise floor. |
| **Voice clarity** | +4 dB presence lift around 3 kHz. |
| **Mono** | Folds stereo to mono. Fixes interviews where a guest is panned hard to one side. |
| **Boost** | Extra 0–12 dB of output gain. A limiter keeps the result from clipping. |

Settings are shared by every tab you're cleaning and are remembered.

## How it works

- The popup (or shortcut) gets a tab-capture stream ID. The service worker opens a hidden
  offscreen document, which captures the tab's audio with `getUserMedia`.
- Chrome mutes a tab while it's captured, so the only thing you hear is the processed output.
  Stopping releases the capture and the tab's normal audio comes back.
- Processing is Web Audio: the two denoisers are WebAssembly AudioWorklets from
  [`@sapphi-red/web-noise-suppressor`](https://github.com/sapphi-red/web-noise-suppressor).
  The leveler is a small custom AudioWorklet (`leveler-worklet.js`).

## Delay

Processing adds about 12 ms with noise reduction off, 33 ms on Max and 44 ms on Natural.
Your audio output and the capture itself add some more on top. The popup shows an estimate.
That's under what most people notice as lip-sync drift, so the video isn't held back.

## Files

| File | Role |
|---|---|
| `manifest.json` | Manifest V3 config |
| `background.js` | Service worker: capture IDs, offscreen lifecycle, settings, badge |
| `offscreen.html/js` | Holds the capture streams and AudioContexts |
| `audio-chain.js` | The processing graph (also runs in an OfflineAudioContext) |
| `leveler-worklet.js` | Automatic gain control |
| `popup.*` | Toolbar popup UI with live before/after meters |
| `settings.js` | Shared defaults |
| `vendor/` | Noise suppression worklets and WASM (see licenses below) |

## Known limits

- Chrome can't capture `chrome://` pages, the Web Store, or a tab another extension or a
  screen share is already capturing.
- Switching noise-reduction modes causes a brief dropout while the new model loads.
- Natural costs roughly 5–10% of one CPU core; Max costs about half that.

## Licenses

- web-noise-suppressor: MIT (`vendor/LICENSE-web-noise-suppressor`)
- RNNoise: BSD-3-Clause, Xiph.Org Foundation and contributors
- GTCRN: MIT, Rong Xiaobin (header in `vendor/gtcrn-worklet.js`)
