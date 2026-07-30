import { useEffect, useRef } from "react";
import { useApp } from "@/contexts";
import { fetchSTT } from "@/lib/functions";
import { shouldUsePluelyAPI } from "@/lib";
import { isMeaningfulTranscription } from "@/lib/utils";

/**
 * Captures the user's OWN microphone while a system-audio session is active,
 * so the AI hears both sides of the conversation. Detected speech is
 * transcribed and handed to `onTranscript` - it never triggers an AI answer
 * by itself; it only enriches conversation context ("[You]: ...").
 *
 * Uses a lightweight RMS voice-activity detector with an adaptive noise
 * floor. A fresh MediaRecorder is started per utterance so every emitted blob
 * is a complete, valid container (mid-stream MediaRecorder chunks are not
 * independently decodable).
 */

const POLL_MS = 100;
const SILENCE_STOP_MS = 1200; // stop the utterance after this much quiet
const MIN_SPEECH_MS = 400; // ignore blips shorter than this
const MAX_UTTERANCE_MS = 30000; // safety cap
const MIN_START_RMS = 0.015; // absolute floor for the start threshold

type Params = {
  /** Capture only while true (typically: session active AND setting on). */
  active: boolean;
  /** Receives the transcription of each utterance from the user's mic. */
  onTranscript: (text: string) => void;
};

export function useMicContext({ active, onTranscript }: Params) {
  const { selectedSttProvider, allSttProviders, contextText } = useApp();

  // Latest-value refs so the long-lived polling loop never goes stale.
  const onTranscriptRef = useRef(onTranscript);
  const sttRef = useRef({ selectedSttProvider, allSttProviders, contextText });
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    sttRef.current = { selectedSttProvider, allSttProviders, contextText };
  }, [selectedSttProvider, allSttProviders, contextText]);

  useEffect(() => {
    if (!active) return;

    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let recorder: MediaRecorder | null = null;
    let disposed = false;

    // VAD state
    let noiseFloor = 0.005; // adaptive ambient estimate (EMA while quiet)
    let speaking = false;
    let quietMs = 0;
    let speechStartedAt = 0;

    const transcribe = async (blob: Blob) => {
      try {
        const { selectedSttProvider, allSttProviders, contextText } =
          sttRef.current;
        const usePluelyAPI = await shouldUsePluelyAPI();
        const providerConfig = allSttProviders.find(
          (p) => p.id === selectedSttProvider.provider
        );
        if (!providerConfig && !usePluelyAPI) return;

        const text = await fetchSTT({
          provider: providerConfig,
          selectedProvider: selectedSttProvider,
          audio: blob,
          contextHint: contextText,
        });
        if (!disposed && isMeaningfulTranscription(text)) {
          onTranscriptRef.current(text);
        }
      } catch (err) {
        // Mic context is best-effort; never surface errors into the session
        console.warn("Mic context transcription failed:", err);
      }
    };

    const stopUtterance = (keep: boolean) => {
      if (!recorder) return;
      const r = recorder;
      recorder = null;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      r.onstop = () => {
        if (keep && chunks.length > 0) {
          transcribe(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
        }
      };
      try {
        r.stop();
      } catch {
        // Recorder may already be inactive; nothing to salvage.
      }
    };

    const startUtterance = () => {
      if (!stream) return;
      try {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : undefined;
        recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined
        );
        recorder.start();
      } catch (err) {
        console.warn("Failed to start mic recorder:", err);
        recorder = null;
      }
    };

    const setup = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const data = new Float32Array(analyser.fftSize);

        pollTimer = setInterval(() => {
          analyser.getFloatTimeDomainData(data);
          let sumSq = 0;
          for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
          const rms = Math.sqrt(sumSq / data.length);

          const startThreshold = Math.max(MIN_START_RMS, noiseFloor * 3);
          const continueThreshold = startThreshold * 0.5; // hysteresis

          if (!speaking) {
            // Track ambient level only while quiet
            noiseFloor = noiseFloor * 0.95 + rms * 0.05;
            if (rms > startThreshold) {
              speaking = true;
              quietMs = 0;
              speechStartedAt = Date.now();
              startUtterance();
            }
          } else {
            if (rms > continueThreshold) {
              quietMs = 0;
            } else {
              quietMs += POLL_MS;
            }

            const duration = Date.now() - speechStartedAt;
            if (quietMs >= SILENCE_STOP_MS || duration >= MAX_UTTERANCE_MS) {
              speaking = false;
              quietMs = 0;
              stopUtterance(duration - quietMs >= MIN_SPEECH_MS);
            }
          }
        }, POLL_MS);
      } catch (err) {
        console.warn("Mic context unavailable (permission denied?):", err);
      }
    };

    setup();

    return () => {
      disposed = true;
      if (pollTimer) clearInterval(pollTimer);
      stopUtterance(false);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioContext) audioContext.close().catch(() => {});
    };
  }, [active]);
}
