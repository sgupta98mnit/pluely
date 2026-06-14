import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const floatArrayToWav = (
  audioData: Float32Array,
  sampleRate: number = 16000,
  format: "wav" | "mp3" | "ogg" = "wav"
): Blob => {
  const buffer = new ArrayBuffer(44 + audioData.length * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  const dataSize =
    format === "wav" ? 36 + audioData.length * 2 : 44 + audioData.length * 2;
  view.setUint32(4, dataSize, true);
  writeString(8, format === "wav" ? "WAVE" : "FORM");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, audioData.length * 2, true);

  // Convert float samples to 16-bit PCM
  let offset = 44;
  for (let i = 0; i < audioData.length; i++) {
    const sample = Math.max(-1, Math.min(1, audioData[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: `audio/${format}` });
};

// Minimum characters/words a transcription must have to be worth an AI call.
const MIN_TRANSCRIPTION_CHARS = 3;
const MIN_TRANSCRIPTION_WORDS = 2;

// Short utterances STT commonly returns for coughs, breaths, or filler that we
// don't want to spend an API round-trip on. Compared case-insensitively after
// stripping surrounding punctuation.
const FILLER_TRANSCRIPTIONS = new Set([
  "uh",
  "um",
  "umm",
  "uhh",
  "hmm",
  "hm",
  "huh",
  "ah",
  "oh",
  "ok",
  "okay",
  "mm",
  "mhm",
  "yeah",
  "yep",
  "no",
  "you",
  "thank you",
  "thanks",
  "bye",
  ".",
  "...",
]);

/**
 * Returns true if a transcription is substantive enough to send to the AI.
 * Filters out empty/whitespace results, trivially short noise, and a small set
 * of common filler phrases that STT produces from coughs/breaths/silence.
 */
export const isMeaningfulTranscription = (text: string | null | undefined): boolean => {
  if (!text) return false;

  const trimmed = text.trim();
  if (trimmed.length < MIN_TRANSCRIPTION_CHARS) return false;

  // Normalize for filler comparison: lowercase, drop surrounding punctuation.
  const normalized = trimmed.toLowerCase().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");
  if (!normalized) return false;
  if (FILLER_TRANSCRIPTIONS.has(normalized)) return false;

  // A single very short word (e.g. "ok.") that slipped past the filler list.
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < MIN_TRANSCRIPTION_WORDS && normalized.length < 4) {
    return false;
  }

  return true;
};
