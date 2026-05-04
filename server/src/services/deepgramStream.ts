/**
 * Deepgram streaming-STT adapter.
 *
 * Why this file exists
 * --------------------
 * The previous transcription path used Sarvam (saaras:v3 translate-stream),
 * which only emits a transcript at end-of-utterance, so users were waiting
 * 5-20 seconds for a sentence to appear. Google-Meet-style live captions
 * need *interim* (mutable) results that update word-by-word as the speaker
 * is still talking, plus quick-arriving finals at sentence boundaries.
 *
 * Deepgram Nova-3 streaming gives us exactly that:
 *   - true partial transcripts (`is_final=false`) every ~150-300 ms
 *   - sentence finals (`is_final=true`)
 *   - utterance ends (`speech_final=true` / `UtteranceEnd`)
 *
 * This module wraps a single Deepgram WS per speaker and exposes a small
 * callback surface so server.ts can stay agnostic of the provider.
 *
 * Pricing reference (May 2026): Nova-3 PAYG streaming = $0.0077/min
 * (~$0.46/hr). New Deepgram accounts get $200 in free credit, which is more
 * than enough headroom for the user's $10 testing budget.
 */

import WebSocket from "ws";

/**
 * Normalize the DEEPGRAM_MODEL env value into an actual Deepgram model id.
 * Accepts shortcuts so the .env stays terse:
 *   flux        → flux-general-en   (Flux v2, English-only, fastest turn-taking)
 *   flux-en     → flux-general-en
 *   flux-multi  → flux-general-multi (Flux v2, 10 languages, accepts language_hint)
 *   nova-3, …   → passed through unchanged (Listen v1)
 */
function canonicalDeepgramModel(model: string): string {
  const t = model.trim().toLowerCase();
  if (t === "flux" || t === "flux-en") return "flux-general-en";
  if (t === "flux-multi") return "flux-general-multi";
  return t;
}

function isFluxListenModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m === "flux-general-en" || m === "flux-general-multi";
}

/**
 * Languages flux-general-multi accepts as `language_hint` values.
 * Source: Deepgram "Flux Multilingual & Language Prompting" docs (2026).
 * Locale subtags (e.g. `en-IN`, `pt-BR`) are accepted by the API but
 * Deepgram normalizes them to the base code — there is no en-IN variant.
 */
const FLUX_MULTI_SUPPORTED_BASES = new Set([
  "en",
  "es",
  "fr",
  "de",
  "hi",
  "ru",
  "pt",
  "ja",
  "it",
  "nl",
]);

type LanguageHintResult = {
  hints: string[];
  unsupported: string[]; // for warn-once logging
};

/**
 * Parse a comma/space-separated language env (e.g. "en-IN,hi") into the set
 * of `language_hint` query params Flux-multi will actually accept.
 *
 * Strategy: for each token we strip the locale subtag (en-IN → en) because
 * Flux normalizes locales to base codes anyway. We then drop anything not
 * in FLUX_MULTI_SUPPORTED_BASES so a typo doesn't 400 the WS handshake.
 */
function languageHintsForFluxMulti(language: string | null): LanguageHintResult {
  const empty: LanguageHintResult = { hints: [], unsupported: [] };
  if (!language) return empty;
  const raw = language.trim().toLowerCase();
  if (!raw || raw === "multi") return empty;
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  const hints = new Set<string>();
  const unsupported: string[] = [];
  for (const tok of tokens) {
    const base = tok.split("-")[0];
    if (!base) continue;
    if (FLUX_MULTI_SUPPORTED_BASES.has(base)) {
      hints.add(base);
    } else {
      unsupported.push(tok);
    }
  }
  return { hints: [...hints], unsupported };
}

export type DeepgramEvent =
  | {
      kind: "interim";
      transcript: string;
      languageCode: string | null;
    }
  | {
      kind: "final";
      transcript: string;
      languageCode: string | null;
      // True at the end of an utterance / speech_final or UtteranceEnd.
      utteranceEnd: boolean;
    }
  | { kind: "speech_started" }
  | { kind: "error"; message: string }
  | { kind: "close"; code: number; reason: string };

export type DeepgramAdapter = {
  ws: WebSocket;
  sendPcm16: (buf: Buffer) => void;
  close: () => void;
};

export type DeepgramOptions = {
  apiKey: string;
  // Deepgram model — keep tunable so we can swap to nova-3-general etc.
  model?: string;
  // Single-language mode is faster + more accurate than auto-detect.
  // Set to `null` / `undefined` to enable Deepgram's "multi" detection.
  language?: string | null;
  // Hard cap on silence before Deepgram emits a final. Lower = snappier.
  endpointingMs?: number;
  // Hard cap on silence before Deepgram emits an UtteranceEnd event.
  utteranceEndMs?: number;
  onEvent: (ev: DeepgramEvent) => void;
};

// ── Connection ───────────────────────────────────────────────

export function createDeepgramWS(opts: DeepgramOptions): DeepgramAdapter | null {
  const {
    apiKey,
    model = "nova-3",
    language = "en-US",
    endpointingMs = 300,
    utteranceEndMs = 1000,
    onEvent,
  } = opts;

  if (!apiKey) {
    console.log("DEEPGRAM_API_KEY not set — Deepgram transcription disabled");
    return null;
  }

  const effectiveModel = canonicalDeepgramModel(model);
  const useFluxListen = isFluxListenModel(effectiveModel);

  // Build WS URL. We send 16 kHz mono PCM16 frames.
  // Nova (v1): interim_results / vad_events / endpointing — Google-Meet-style.
  // Flux (v2): turn-based TurnInfo stream per Deepgram conversational STT docs.
  const safeEndpoint =
    typeof endpointingMs === "number" && Number.isFinite(endpointingMs)
      ? endpointingMs
      : 300;
  const rawUtterance =
    typeof utteranceEndMs === "number" && Number.isFinite(utteranceEndMs)
      ? utteranceEndMs
      : 1000;
  const eotTimeoutClamped = Math.min(
    10_000,
    Math.max(500, Math.round(rawUtterance)),
  );

  let url: string;
  if (useFluxListen) {
    const fluxParams = new URLSearchParams({
      model: effectiveModel,
      encoding: "linear16",
      sample_rate: "16000",
      eot_timeout_ms: String(eotTimeoutClamped),
    });
    if (effectiveModel === "flux-general-multi") {
      // language_hint is only valid here (flux-general-en 400s on it).
      const { hints, unsupported } = languageHintsForFluxMulti(language);
      for (const hint of hints) fluxParams.append("language_hint", hint);
      if (hints.length > 0) {
        console.log(
          `Deepgram: flux-general-multi using language_hint=[${hints.join(",")}]`,
        );
      } else {
        console.log(
          "Deepgram: flux-general-multi running with auto language detection",
        );
      }
      if (unsupported.length > 0) {
        console.warn(
          `Deepgram: dropped unsupported language hint(s) [${unsupported.join(", ")}]. ` +
            `flux-general-multi only accepts: ${[...FLUX_MULTI_SUPPORTED_BASES].join(", ")}. ` +
            `Locale subtags like en-IN are normalized to the base code (en) — there is no en-IN-specific Flux variant. ` +
            `If you need Indian-English locale tuning, use DEEPGRAM_MODEL=nova-3 with DEEPGRAM_LANGUAGE=en-IN instead.`,
        );
      }
    } else {
      // flux-general-en
      if (language && language.trim() && language.trim().toLowerCase() !== "en") {
        console.log(
          `Deepgram: DEEPGRAM_LANGUAGE=${language} ignored — flux-general-en is English-only and rejects language_hint. ` +
            `It handles all English accents (incl. Indian English). For an explicit en-IN locale, switch DEEPGRAM_MODEL to nova-3.`,
        );
      }
    }
    url = `wss://api.deepgram.com/v2/listen?${fluxParams.toString()}`;
  } else {
    const params = new URLSearchParams({
      model: effectiveModel,
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      vad_events: "true",
      endpointing: String(safeEndpoint),
      utterance_end_ms: String(rawUtterance),
    });
    if (language) {
      params.set("language", language);
      console.log(`Deepgram: ${effectiveModel} using language=${language}`);
    }
    url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(url, {
      headers: { Authorization: `Token ${apiKey}` },
    });
  } catch (err: any) {
    console.error("Deepgram WS creation failed:", err.message);
    return null;
  }

  let keepAlive: NodeJS.Timeout | null = null;

  ws.on("open", () => {
    // Deepgram v1 Nova closes idle sockets after ~10 s; KeepAlive is documented for v1.
    if (!useFluxListen) {
      keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          } catch {}
        }
      }, 8000);
    }
  });

  ws.on("message", (raw: WebSocket.RawData) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleDeepgramMessage(msg, onEvent, { flux: useFluxListen });
  });

  ws.on("error", (err: Error) => {
    onEvent({ kind: "error", message: err.message });
  });

  ws.on("close", (code: number, reason: Buffer) => {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    onEvent({ kind: "close", code, reason: reason?.toString() || "" });
  });

  return {
    ws,
    sendPcm16(buf: Buffer) {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Deepgram expects raw binary frames for linear16. No JSON wrapper.
      try {
        ws.send(buf, { binary: true });
      } catch {}
    },
    close() {
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          // Tell Deepgram we're done so it flushes the last final before close.
          ws.send(JSON.stringify({ type: "CloseStream" }));
        }
      } catch {}
      try {
        ws.close();
      } catch {}
    },
  };
}

// ── Message parsing ──────────────────────────────────────────

function handleFluxV2TurnInfo(msg: any, onEvent: (ev: DeepgramEvent) => void) {
  const event = msg?.event as string | undefined;
  const transcript = String(msg?.transcript ?? "").trim();
  const lang =
    Array.isArray(msg?.languages) && msg.languages.length > 0
      ? String(msg.languages[0])
      : null;

  // End-of-turn first: avoids double-emitting the same transcript as interim.
  if (event === "EndOfTurn") {
    if (transcript) {
      onEvent({
        kind: "final",
        transcript,
        languageCode: lang,
        utteranceEnd: true,
      });
    } else {
      onEvent({
        kind: "final",
        transcript: "",
        languageCode: null,
        utteranceEnd: true,
      });
    }
    return;
  }

  if (event === "StartOfTurn") {
    onEvent({ kind: "speech_started" });
  }

  if (
    transcript &&
    (event === "Update" ||
      event === "StartOfTurn" ||
      event === "TurnResumed" ||
      event === "EagerEndOfTurn")
  ) {
    onEvent({ kind: "interim", transcript, languageCode: lang });
  }
}

function handleDeepgramMessage(
  msg: any,
  onEvent: (ev: DeepgramEvent) => void,
  ctx: { flux: boolean },
) {
  const type = msg?.type;

  if (ctx.flux) {
    if (type === "FatalError") {
      const m =
        typeof msg?.description === "string"
          ? msg.description
          : typeof msg?.err_msg === "string"
            ? msg.err_msg
            : typeof msg?.message === "string"
              ? msg.message
              : JSON.stringify(msg);
      onEvent({ kind: "error", message: m });
      return;
    }
    if (type === "TurnInfo") {
      handleFluxV2TurnInfo(msg, onEvent);
      return;
    }
    return;
  }

  if (type === "Results") {
    const alt = msg?.channel?.alternatives?.[0];
    const transcript = String(alt?.transcript ?? "").trim();
    if (!transcript) return; // skip empty heartbeats
    const isFinal = !!msg.is_final;
    const speechFinal = !!msg.speech_final;
    const lang = msg?.channel?.detected_language || msg?.language || null;
    if (!isFinal) {
      onEvent({ kind: "interim", transcript, languageCode: lang });
      return;
    }
    onEvent({
      kind: "final",
      transcript,
      languageCode: lang,
      utteranceEnd: speechFinal,
    });
    return;
  }

  if (type === "UtteranceEnd") {
    // Deepgram has decided the speaker stopped. Commit whatever we have.
    onEvent({
      kind: "final",
      transcript: "",
      languageCode: null,
      utteranceEnd: true,
    });
    return;
  }

  if (type === "SpeechStarted") {
    onEvent({ kind: "speech_started" });
    return;
  }
  // Metadata / Warning / etc — ignore.
}
