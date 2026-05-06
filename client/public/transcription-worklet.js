/**
 * AudioWorklet processor for live transcription capture.
 *
 * Replaces the deprecated ScriptProcessorNode (which ran on the main thread,
 * had high latency at large buffers, and chewed CPU at small ones).
 *
 * Behaviour:
 *   - Runs on the audio thread, render-quantum granularity (128 frames).
 *   - Accumulates input samples until ~100 ms have piled up, then posts
 *     a single Float32Array back to the main thread via `port.postMessage`.
 *   - Skips the RMS gate that used to live in the old hook — Deepgram's
 *     server-side VAD handles silence; gating in the browser was eating
 *     the soft onsets of words and causing the "wait for a sentence to
 *     appear" feel.
 */
class TranscriptionProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const opts = (options && options.processorOptions) || {};
        // Input rate (== AudioContext.sampleRate). Used by the main thread to
        // decide whether to resample before sending upstream.
        this._inputRate = opts.inputRate || sampleRate;
        // ~100 ms chunks. Smaller = lower latency but more socket emits.
        this._chunkFrames = Math.max(
            256,
            Math.floor((opts.chunkMs || 100) * 0.001 * this._inputRate),
        );
        this._buf = new Float32Array(this._chunkFrames);
        this._w = 0;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;
        const ch0 = input[0]; // mono
        if (!ch0) return true;

        let i = 0;
        while (i < ch0.length) {
            const space = this._chunkFrames - this._w;
            const take = Math.min(space, ch0.length - i);
            this._buf.set(ch0.subarray(i, i + take), this._w);
            this._w += take;
            i += take;
            if (this._w >= this._chunkFrames) {
                // Transfer a copy so the worklet can keep reusing its buffer.
                const out = this._buf.slice(0);
                this.port.postMessage({ chunk: out, rate: this._inputRate }, [
                    out.buffer,
                ]);
                this._w = 0;
            }
        }
        return true;
    }
}

registerProcessor("transcription-processor", TranscriptionProcessor);
