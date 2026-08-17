import { useState } from "react";
import {
  useListEntries, useUpdateEntry, useDeleteEntry,
  getListEntriesQueryKey, getGetEntryStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, AlertCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { logEvent } from "@/lib/analytics";

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

export default function CategoryList({ category, title, description }: CategoryListProps) {
  const { data: entries, isLoading, isError, refetch } = useListEntries({ category });
  const updateEntry = useUpdateEntry();
  const deleteEntry = useDeleteEntry();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const empty = EMPTY_MESSAGES[category] ?? { headline: "Nothing here yet", sub: "" };

  const toggleTask = (id: number, isDone: boolean) => {
    updateEntry.mutate(
      { id, data: { isTaskDone: isDone } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category }) }) },
    );
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await deleteEntry.mutateAsync({ id });
      logEvent("entry_deleted", { entryId: id, category });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category }) }),
        queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() }),
      ]);
      if (expandedId === id) setExpandedId(null);
    } catch (err) {
      console.error("Delete failed", err);
    } finally {
      setDeletingId(null);
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
            const isDone = entry.isTaskDone;
            const isDeleting = deletingId === entry.id;

            return (
              <div
                key={entry.id}
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
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
                    <p className={`text-foreground leading-relaxed transition-all ${!isExpanded ? "line-clamp-2" : ""} ${isDone ? "line-through text-muted-foreground" : ""}`}>
                      {entry.content}
                    </p>

                    <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                      <span>{formatDate(entry.createdAt)}</span>

                      {isExpanded && (
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
