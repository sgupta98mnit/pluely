import { useCallback, useEffect, useState } from "react";
import { ChatConversation } from "@/types";
import { Markdown, CopyButton } from "@/components";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2,
  SparklesIcon,
} from "lucide-react";
import { QuestionNavigator } from "./QuestionNavigator";
import { pairConversation } from "./pairConversation";

type Props = {
  lastTranscription: string;
  lastAIResponse: string;
  isAIProcessing: boolean;
  conversation: ChatConversation;
};

export const ResultsSection = ({
  lastTranscription,
  lastAIResponse,
  isAIProcessing,
  conversation,
}: Props) => {
  // Selection state for the question navigator. `followLive` (default) tracks
  // the newest answer; once the user pins an older question we stop following
  // so incoming answers don't yank them away from what they're reading.
  const [followLive, setFollowLive] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset to live whenever a new conversation starts.
  useEffect(() => {
    setFollowLive(true);
    setSelectedId(null);
  }, [conversation.id]);

  // The in-flight answer isn't in conversation.messages yet - surface it as the
  // top "answering" entry only while streaming.
  const live =
    isAIProcessing && lastTranscription
      ? { question: lastTranscription, answer: lastAIResponse }
      : null;
  const items = pairConversation(conversation.messages, live);

  const activeItem =
    (followLive ? items[0] : items.find((i) => i.id === selectedId)) ??
    items[0];

  // Items are newest-first, so "older" moves to a higher index, "newer" to a
  // lower one. Landing back on the newest resumes following live so the user
  // isn't stuck pinned when the next question comes in.
  const activeIndex = activeItem
    ? Math.max(
        0,
        items.findIndex((i) => i.id === activeItem.id)
      )
    : 0;

  const selectIndex = useCallback(
    (index: number) => {
      if (items.length === 0) return;
      const clamped = Math.min(items.length - 1, Math.max(0, index));
      if (clamped === 0) {
        setFollowLive(true);
        setSelectedId(null);
      } else {
        setFollowLive(false);
        setSelectedId(items[clamped].id);
      }
    },
    [items]
  );

  // Alt+Left/Up = older question, Alt+Right/Down = newer. Lets the user jump
  // back to what the boss asked earlier without touching the mouse.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        selectIndex(activeIndex + 1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        selectIndex(activeIndex - 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, selectIndex]);

  if (items.length === 0 || !activeItem) {
    return null;
  }

  const isActiveAnswering = activeItem.status === "answering";

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      {/* Question navigator - only when there's more than one to navigate */}
      {items.length > 1 && (
        <QuestionNavigator
          items={items}
          selectedId={selectedId}
          isLive={followLive}
          onSelect={(id) => {
            setFollowLive(false);
            setSelectedId(id);
          }}
          onGoLive={() => {
            setFollowLive(true);
            setSelectedId(null);
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="w-3.5 h-3.5 text-primary" />
          <h4 className="text-xs font-medium">AI Response</h4>
        </div>
        <div className="flex items-center gap-1">
          {items.length > 1 && (
            <div className="flex items-center gap-0.5 mr-1">
              <button
                type="button"
                onClick={() => selectIndex(activeIndex + 1)}
                disabled={activeIndex >= items.length - 1}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted/60 disabled:opacity-30"
                title="Older question (Alt+←)"
              >
                <ChevronLeftIcon className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {items.length - activeIndex}/{items.length}
              </span>
              <button
                type="button"
                onClick={() => selectIndex(activeIndex - 1)}
                disabled={activeIndex <= 0}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted/60 disabled:opacity-30"
                title="Newer question (Alt+→)"
              >
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {activeItem.answer && <CopyButton content={activeItem.answer} />}
        </div>
      </div>

      {/* Selected question + its answer */}
      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          <span className="font-semibold">System:</span> {activeItem.question}
        </p>

        {isActiveAnswering && !activeItem.answer ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">
              Generating response...
            </span>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <Markdown>{activeItem.answer}</Markdown>
            {isActiveAnswering && (
              <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
