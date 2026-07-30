import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components";
import { KeyboardIcon } from "lucide-react";
import { DEFAULT_SHORTCUT_ACTIONS } from "@/config";

const formatKey = (key: string) =>
  key
    .split("+")
    .map((part) => {
      const p = part.trim().toLowerCase();
      if (p === "cmd") return "⌘";
      if (p === "ctrl") return "Ctrl";
      if (p === "shift") return "Shift";
      if (p === "alt") return "Alt";
      if (p === "backslash") return "\\";
      return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
    })
    .join(" + ");

export const ShortcutsHelp = () => {
  const [open, setOpen] = useState(false);
  const [registered, setRegistered] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    invoke<Record<string, string>>("get_registered_shortcuts")
      .then(setRegistered)
      .catch(() => setRegistered({}));
  }, [open]);

  const rows = DEFAULT_SHORTCUT_ACTIONS.map((action) => {
    const key =
      registered[action.id] ??
      (action.id === "move_window"
        ? registered["move_window_up"]?.replace(/\+up$/i, "")
        : undefined);
    return { ...action, key };
  }).filter((row) => row.key);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          title="Show keyboard shortcuts"
          className="text-[10px] lg:text-sm h-6 lg:h-8"
        >
          Shortcuts <KeyboardIcon className="size-3 lg:size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col divide-y divide-border">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No shortcuts are currently registered.
            </p>
          )}
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-start justify-between gap-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{row.name}</div>
                <div className="text-xs text-muted-foreground">
                  {row.description}
                </div>
              </div>
              <kbd className="shrink-0 rounded border border-border bg-muted px-2 py-1 text-xs font-mono">
                {formatKey(row.key as string)}
                {row.id === "move_window" ? " + ← ↑ → ↓" : ""}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
