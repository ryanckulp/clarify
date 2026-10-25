//#region src/noiseGate/workletUtil.ts
const id$3 = "@sapphi-red/web-noise-suppressor/noise-gate";
//#endregion
//#region src/noiseGate/workletNode.ts
var NoiseGateWorkletNode = class extends AudioWorkletNode {
	constructor(context, { openThreshold, closeThreshold = openThreshold, holdMs, maxChannels }) {
		super(context, id$3, { processorOptions: {
			openThreshold,
			closeThreshold,
			holdMs,
			maxChannels
		} });
	}
};
//#endregion
//#region src/utils/fetchArrayBuffer.ts
const fetchArrayBuffer = async (url, init) => {
	return await (await fetch(url, init)).arrayBuffer();
};
//#endregion
//#region src/gtcrn/load.ts
const loadGtcrn = async ({ url }, init) => {
	return await fetchArrayBuffer(url, init);
};
//#endregion
//#region src/gtcrn/workletUtil.ts
const id$2 = "@sapphi-red/web-noise-suppressor/gtcrn";
//#endregion
//#region src/gtcrn/workletNode.ts
var GtcrnWorkletNode = class extends AudioWorkletNode {
	constructor(context, { maxChannels, wasmBinary }) {
		super(context, id$2, { processorOptions: {
			maxChannels,
			wasmBinary
		} });
	}
	destroy() {
		this.port.postMessage("destroy");
	}
};
//#endregion
//#region node_modules/.pnpm/wasm-feature-detect@1.9.0/node_modules/wasm-feature-detect/dist/esm/index.js
const simd = async () => WebAssembly.validate(new Uint8Array([
	0,
	97,
	115,
	109,
	1,
	0,
	0,
	0,
	1,
	5,
	1,
	96,
	0,
	1,
	123,
	3,
	2,
	1,
	0,
	10,
	10,
	1,
	8,
	0,
	65,
	0,
	253,
	15,
	253,
	98,
	11
]));
//#endregion
//#region src/rnnoise/load.ts
const loadRnnoise = async ({ url, simdUrl }, init) => {
	const loadUrl = await simd() ? simdUrl : url;
	return await fetchArrayBuffer(loadUrl, init);
};
//#endregion
//#region src/rnnoise/workletUtil.ts
const id$1 = "@sapphi-red/web-noise-suppressor/rnnoise";
//#endregion
//#region src/rnnoise/workletNode.ts
/**
* Assumes sample rate to be 48kHz.
*/
var RnnoiseWorkletNode = class extends AudioWorkletNode {
	constructor(context, { maxChannels, wasmBinary }) {
		super(context, id$1, { processorOptions: {
			maxChannels,
			wasmBinary
		} });
	}
	destroy() {
		this.port.postMessage("destroy");
	}
};
//#endregion
//#region src/speex/load.ts
const loadSpeex = async ({ url }, init) => {
	return await fetchArrayBuffer(url, init);
};
//#endregion
//#region src/speex/workletUtil.ts
const id = "@sapphi-red/web-noise-suppressor/speex";
//#endregion
//#region src/speex/workletNode.ts
var SpeexWorkletNode = class extends AudioWorkletNode {
	constructor(context, { maxChannels, wasmBinary }) {
		super(context, id, { processorOptions: {
			maxChannels,
			wasmBinary
		} });
	}
	destroy() {
		this.port.postMessage("destroy");
	}
};
//#endregion
export { GtcrnWorkletNode, NoiseGateWorkletNode, RnnoiseWorkletNode, SpeexWorkletNode, loadGtcrn, loadRnnoise, loadSpeex };

