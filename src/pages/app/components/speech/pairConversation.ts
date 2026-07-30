import { ChatMessage } from "@/types/completion";

/**
 * A boss question paired with its AI answer, for the question navigator.
 */
export type QuestionItem = {
  /** Stable id - the user message's id, or "live" for the in-flight one. */
  id: string;
  question: string;
  answer: string;
  timestamp: number;
  status: "answering" | "answered";
};

/**
 * Builds the newest-first list of question/answer pairs that the navigator
 * renders.
 *
 * `conversation.messages` is stored newest-first with each `user` (boss)
 * message immediately followed by its `assistant` answer (see
 * useSystemAudio.processWithAI). We pair a user message with the assistant
 * message that follows it; orphan user messages (e.g. a quick-action turn with
 * no adjacent answer) are skipped since there's no answer to navigate to.
 *
 * The currently-streaming answer isn't in `messages` yet — it lives in
 * `lastTranscription`/`lastAIResponse`. Pass it as `live` while AI is
 * processing so it appears at the top as an "answering" entry; once it
 * completes it moves into `messages`, so don't pass `live` then (avoids a
 * duplicate top row).
 */
export function pairConversation(
  messages: ChatMessage[],
  live?: { question: string; answer: string } | null
): QuestionItem[] {
  const items: QuestionItem[] = [];

  if (live && live.question.trim()) {
    items.push({
      id: "live",
      question: live.question,
      answer: live.answer,
      timestamp: Date.now(),
      status: "answering",
    });
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "user") continue;

    const next = messages[i + 1];
    if (next && next.role === "assistant") {
      items.push({
        id: message.id,
        question: message.content,
        answer: next.content,
        timestamp: message.timestamp,
        status: "answered",
      });
    }
  }

  return items;
}

/** Compact relative time like "now", "15s", "3m", "2h". */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}
