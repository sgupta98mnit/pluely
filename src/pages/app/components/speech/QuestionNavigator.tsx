import { RadioIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuestionItem, formatRelativeTime } from "./pairConversation";

type Props = {
  items: QuestionItem[];
  /** The selected question id, or null when following live/newest. */
  selectedId: string | null;
  /** Whether the view is following the newest answer. */
  isLive: boolean;
  onSelect: (id: string) => void;
  onGoLive: () => void;
};

/**
 * A compact, newest-first rail of the boss's questions. Tapping a row pins the
 * answer view to that question; the "Live" pill returns to following the
 * newest. Pure navigation - selecting never triggers a new AI call.
 */
export const QuestionNavigator = ({
  items,
  selectedId,
  isLive,
  onSelect,
  onGoLive,
}: Props) => {
  // A newer answer has arrived since the user pinned an older one.
  const hasNewerThanSelected =
    !isLive && items.length > 0 && items[0].id !== selectedId;

  return (
    <div className="rounded-lg border border-border/50 bg-background/40">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border/50">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Questions ({items.length})
        </span>
        <button
          type="button"
          onClick={onGoLive}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
            isLive
              ? "bg-green-500/15 text-green-600"
              : "text-muted-foreground hover:bg-muted/60"
          )}
          title="Follow the newest answer"
        >
          <RadioIcon className="h-3 w-3" />
          Live
          {hasNewerThanSelected && (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-green-500" />
          )}
        </button>
      </div>

      <div className="max-h-32 overflow-y-auto p-1 space-y-0.5">
        {items.map((item, index) => {
          const isActive = isLive ? index === 0 : item.id === selectedId;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                isActive
                  ? "bg-primary/10 border-l-2 border-primary"
                  : "border-l-2 border-transparent hover:bg-muted/50"
              )}
            >
              <span className="flex-1 min-w-0 truncate text-[11px]">
                {item.question}
              </span>
              {item.status === "answering" ? (
                <span className="flex items-center gap-1 text-[9px] text-primary flex-shrink-0">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  answering
                </span>
              ) : (
                <span className="text-[9px] text-muted-foreground/60 flex-shrink-0 tabular-nums">
                  {formatRelativeTime(item.timestamp)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
