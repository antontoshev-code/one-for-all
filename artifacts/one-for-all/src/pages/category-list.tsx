import { useState, useEffect } from "react";
import {
  useListEntries, useUpdateEntry, useDeleteEntry,
  getListEntriesQueryKey, getGetEntryStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Trash2, AlertCircle, Pencil, Check, X, CalendarPlus, Clock, Download,
} from "lucide-react";
import { formatDate, formatDueDate } from "@/lib/utils";
import { downloadIcs, googleCalendarUrl } from "@/lib/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { logEvent } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

// ── Per-category copy ─────────────────────────────────────────────────────

const EMPTY_MESSAGES: Record<string, { headline: string; sub: string }> = {
  journal: {
    headline: "Nothing written yet",
    sub: "Capture a reflection and it'll appear here once you move it from Inbox.",
  },
  task: {
    headline: "No tasks yet",
    sub: "Capture something you need to do and accept it as a Task from Inbox.",
  },
  idea: {
    headline: "No ideas yet",
    sub: "Capture a concept or what-if thought and accept it as an Idea from Inbox.",
  },
  log: {
    headline: "Nothing logged yet",
    sub: "Capture what you've done or experienced and accept it as a Log entry.",
  },
};

// ── Props ─────────────────────────────────────────────────────────────────

interface CategoryListProps {
  category: "journal" | "task" | "idea" | "log";
  title: string;
  description: string;
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * A Date as the value a datetime-local input expects.
 *
 * That input has no concept of a timezone: it reads and writes wall-clock time.
 * Handing it an ISO string in UTC shifts every task by the offset, so a task at
 * 21:20 in Sofia shows as 18:20 and saving it moves the task three hours.
 */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function CategoryList({ category, title, description }: CategoryListProps) {
  const { data: entries, isLoading, isError, refetch } = useListEntries({ category });
  const updateEntry = useUpdateEntry();
  const deleteEntry = useDeleteEntry();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  /**
   * Arriving from History with ?entry=… opens that entry and scrolls to it.
   *
   * The link used to point at the whole list, which for someone who has just
   * found the thing they were looking for in History means losing it again
   * among forty others.
   */
  const requestedId = (() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("entry");
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) ? id : null;
  })();

  const [expandedId, setExpandedId] = useState<number | null>(requestedId);

  useEffect(() => {
    if (requestedId === null || !entries?.length) return;
    // After the list has rendered, so the element exists to scroll to.
    const node = document.getElementById(`entry-${requestedId}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [requestedId, entries]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const empty = EMPTY_MESSAGES[category] ?? { headline: "Nothing here yet", sub: "" };

  /**
   * Toggle a task, with a way back.
   *
   * A ticked task leaves the list, so a mis-tap costs you the item and the
   * hunt to find it again. Undo is offered here and not on delete for an
   * honest reason: this is a field flip and is genuinely reversible, whereas a
   * deleted entry is gone from the database and "undo" would only ever be a
   * different entry wearing its text. Delete keeps its confirmation instead.
   */
  const toggleTask = (id: number, isDone: boolean, options?: { silent?: boolean }) => {
    updateEntry.mutate(
      { id, data: { isTaskDone: isDone } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category }) });
          // Invalidate stats so Home task count stays accurate
          queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() });

          // The undo itself must not offer its own undo, or the toast never ends.
          if (options?.silent) return;

          toast({
            title: isDone ? "Task completed" : "Task reopened",
            action: (
              <ToastAction
                altText="Undo"
                onClick={() => toggleTask(id, !isDone, { silent: true })}
              >
                Undo
              </ToastAction>
            ),
          });
        },
      },
    );
  };

  /** Set or clear a task's due time. Failure leaves the old time in place. */
  const setDue = async (id: number, due: Date | null) => {
    try {
      const res = await fetch(`/api/entries/${id}/due`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: due ? due.toISOString() : null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshLists();
    } catch (err) {
      console.error("Failed to change the due time", err);
      toast({ title: "Could not change the time", description: "Please try again." });
    }
  };

  const refreshLists = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category }) }),
    queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() }),
  ]);

  /**
   * Delete is now reversible — the row is kept and marked deleted, so Undo
   * genuinely restores it rather than writing a new entry that merely looks
   * the same. A confirmation dialog isn't a safety net; people confirm by
   * reflex, and this is something they wrote about their own life.
   */
  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await deleteEntry.mutateAsync({ id });
      logEvent("entry_deleted", { entryId: id, category });
      await refreshLists();
      if (expandedId === id) setExpandedId(null);
      if (editingId === id) setEditingId(null);

      toast({
        title: "Deleted",
        action: (
          <ToastAction
            altText="Undo"
            onClick={async () => {
              try {
                const res = await fetch(`/api/entries/${id}/restore`, { method: "POST" });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                await refreshLists();
              } catch (err) {
                console.error("Restore failed", err);
                toast({ title: "Could not undo", description: "Please try again." });
              }
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    } catch (err) {
      console.error("Delete failed", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartEdit = (id: number, currentContent: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditText(currentContent);
    // Ensure the card stays expanded while editing
    if (expandedId !== id) setExpandedId(id);
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setEditText("");
  };

  const handleSaveEdit = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const trimmed = editText.trim();
    if (!trimmed || isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      await updateEntry.mutateAsync({ id, data: { content: trimmed } });
      logEvent("entry_edited", { entryId: id, category });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category }) }),
        queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() }),
      ]);
      setEditingId(null);
      setEditText("");
    } catch (err) {
      console.error("Edit save failed", err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
        <header className="mb-8 px-2">
          <h1 className="text-3xl font-semibold tracking-tight capitalize">{title}</h1>
          <p className="text-muted-foreground mt-1">{description}</p>
        </header>
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (isError) {
    return (
      <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
        <header className="mb-8 px-2">
          <h1 className="text-3xl font-semibold tracking-tight capitalize">{title}</h1>
          <p className="text-muted-foreground mt-1">{description}</p>
        </header>
        <div className="flex flex-col items-center gap-4 py-16 text-center px-4">
          <AlertCircle className="w-10 h-10 text-muted-foreground/50" />
          <div>
            <p className="font-medium text-foreground mb-1">Couldn't load your {title.toLowerCase()} entries</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
          </div>
          <Button variant="outline" className="rounded-full" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
      <header className="mb-8 px-2">
        <h1 className="text-3xl font-semibold tracking-tight capitalize">{title}</h1>
        <p className="text-muted-foreground mt-1">{description}</p>
      </header>

      {entries?.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center text-center py-16 px-6 bg-card rounded-3xl border border-border/50 border-dashed">
          <p className="font-medium text-foreground mb-1">{empty.headline}</p>
          <p className="text-sm text-muted-foreground">{empty.sub}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {entries?.map((entry, i) => {
            const isExpanded = expandedId === entry.id;
            const isEditing = editingId === entry.id;
            const isDone = entry.isTaskDone;
            const rawDue = (entry as { dueAt?: string | null }).dueAt;
            const dueAt = rawDue ? new Date(rawDue) : null;
            const isOverdue = Boolean(dueAt && !isDone && dueAt.getTime() < Date.now());
            const isDeleting = deletingId === entry.id;

            return (
              <div
                key={entry.id}
                id={`entry-${entry.id}`}
                onClick={() => {
                  // Don't collapse while editing
                  if (isEditing) return;
                  setExpandedId(isExpanded ? null : entry.id);
                }}
                className={`bg-card border border-border/40 rounded-3xl p-4 transition-all duration-300 cursor-pointer animate-in slide-in-from-bottom-2 fade-in ${
                  isExpanded ? "shadow-md" : "hover:bg-accent/30"
                }`}
                style={{ animationDelay: `${i * 30}ms`, animationFillMode: "both" }}
              >
                <div className="flex gap-3">
                  {category === "task" && (
                    <div className="pt-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={isDone}
                        onCheckedChange={checked => toggleTask(entry.id, !!checked)}
                        className="rounded-full w-6 h-6"
                      />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    {/* Content — either plain text or editable textarea */}
                    {isEditing ? (
                      <Textarea
                        autoFocus
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="text-foreground leading-relaxed resize-none rounded-xl text-[15px] min-h-[80px]"
                        rows={3}
                      />
                    ) : (
                      <p className={`text-foreground leading-relaxed transition-all ${!isExpanded ? "line-clamp-2" : ""} ${isDone ? "line-through text-muted-foreground" : ""}`}>
                        {entry.content}
                      </p>
                    )}

                    {/* When a task said when it happens, say so and offer to
                        put it in the calendar the user actually gets reminded
                        by. A notification from this app would only fire while
                        the page is open — which at 21:20 it will not be. */}
                    {dueAt && (
                      <div className="flex items-center justify-between gap-2 mt-3">
                        {/* Editable: "at 8 or 8:30" was heard as 8:00 and
                            locked there, with no way to correct it short of
                            deleting the task. A guessed time has to be a
                            starting point, not a decision. */}
                        <label className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full cursor-pointer ${
                          isOverdue
                            ? "bg-destructive/10 text-destructive"
                            : "bg-secondary text-secondary-foreground"
                        }`}>
                          <Clock className="w-3 h-3" />
                          {formatDueDate(dueAt)}
                          <input
                            type="datetime-local"
                            // Rendered as a local value: the input has no
                            // timezone, and handing it a UTC string moves every
                            // task by the offset.
                            value={toLocalInputValue(dueAt)}
                            onClick={e => e.stopPropagation()}
                            onChange={e => {
                              e.stopPropagation();
                              const next = e.target.value ? new Date(e.target.value) : null;
                              void setDue(entry.id, next);
                            }}
                            className="sr-only"
                            aria-label="Change when this is due"
                          />
                        </label>
                        {!isDone && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                onClick={e => e.stopPropagation()}
                                className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors shrink-0"
                              >
                                <CalendarPlus className="w-3.5 h-3.5" />
                                Add to calendar
                              </button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-56 p-2 rounded-2xl"
                              onClick={e => e.stopPropagation()}
                            >
                              {/* Google first: a link opens a pre-filled event
                                  in one tap, whereas the file lands in Downloads
                                  and leaves the person to work out what opens it. */}
                              <a
                                href={googleCalendarUrl({
                                  title: entry.content ?? "Task",
                                  start: dueAt,
                                  uid: `one-for-all-entry-${entry.id}`,
                                })}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-sm px-2 py-2 rounded-lg hover:bg-secondary transition-colors"
                              >
                                <CalendarPlus className="w-4 h-4 shrink-0 text-primary" />
                                Google Calendar
                              </a>
                              <button
                                onClick={() => downloadIcs({
                                  title: entry.content ?? "Task",
                                  start: dueAt,
                                  uid: `one-for-all-entry-${entry.id}`,
                                })}
                                className="w-full flex items-center gap-2 text-sm px-2 py-2 rounded-lg hover:bg-secondary transition-colors text-left"
                              >
                                <Download className="w-4 h-4 shrink-0 text-muted-foreground" />
                                <span>
                                  Apple, Outlook, other
                                  <span className="block text-[11px] text-muted-foreground">
                                    Downloads a calendar file
                                  </span>
                                </span>
                              </button>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                      <span>{formatDate(entry.createdAt)}</span>

                      {isExpanded && !isEditing && (
                        <div className="flex items-center gap-1">
                          {/* Edit button */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-9 h-9 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground shrink-0"
                            disabled={isDeleting}
                            onClick={e => handleStartEdit(entry.id, entry.content ?? "", e)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>

                          {/* Delete button */}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-9 h-9 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                                disabled={isDeleting}
                                onClick={e => e.stopPropagation()}
                              >
                                {isDeleting
                                  ? <Loader2 className="w-4 h-4 animate-spin" />
                                  : <Trash2 className="w-4 h-4" />}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This permanently removes the entry. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel onClick={e => e.stopPropagation()}>
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={e => { e.stopPropagation(); handleDelete(entry.id); }}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}

                      {/* Save / Cancel row when editing */}
                      {isEditing && (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-9 h-9 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground shrink-0"
                            onClick={handleCancelEdit}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-9 h-9 rounded-full text-primary hover:bg-primary/10 shrink-0"
                            disabled={isSavingEdit || !editText.trim()}
                            onClick={e => handleSaveEdit(entry.id, e)}
                          >
                            {isSavingEdit
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Check className="w-4 h-4" />}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
