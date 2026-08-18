import { useState, useEffect, useRef } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetPerson, useUpdatePerson, useDeletePerson,
  getGetPersonQueryKey, useUnlinkPersonFromEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowLeft, Trash2, Unlink, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDate } from "@/lib/utils";

export default function PersonDetail() {
  const { id } = useParams();
  const personId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: person, isLoading, isError, refetch } = useGetPerson(personId);
  const updatePerson = useUpdatePerson();
  const deletePerson = useDeletePerson();
  const unlinkPerson = useUnlinkPersonFromEntry();

  const [notes, setNotes] = useState("");
  const initRef = useRef<number | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);

  useEffect(() => {
    if (person && initRef.current !== person.id) {
      setNotes(person.notes || "");
      initRef.current = person.id;
    }
  }, [person]);

  const handleSaveNotes = () => {
    if (!person) return;
    updatePerson.mutate(
      { id: person.id, data: { notes } },
      {
        onSuccess: data => {
          queryClient.setQueryData(getGetPersonQueryKey(person.id), (old: any) =>
            old ? { ...old, notes: data.notes } : old
          );
        },
      },
    );
  };

  const handleDelete = () => {
    if (!person) return;
    deletePerson.mutate({ id: person.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/people"] });
        setLocation("/people");
      },
    });
  };

  const handleUnlink = async (entryId: number) => {
    setUnlinkingId(entryId);
    try {
      await unlinkPerson.mutateAsync({ id: entryId, personId });
      queryClient.invalidateQueries({ queryKey: getGetPersonQueryKey(personId) });
    } catch (err) {
      console.error("Unlink failed", err);
    } finally {
      setUnlinkingId(null);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (isError) {
    return (
      <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-8 max-w-2xl mx-auto w-full">
        <Link href="/people" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors w-max">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Link>
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/50" />
          <div>
            <p className="font-medium text-foreground mb-1">Couldn't load this person</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
          </div>
          <Button variant="outline" className="rounded-full" onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────

  if (!person) {
    return (
      <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-8 max-w-2xl mx-auto w-full">
        <Link href="/people" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors w-max">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Link>
        <p className="text-muted-foreground p-4">Person not found.</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-8 max-w-2xl mx-auto w-full">
      <Link href="/people" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors w-max">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </Link>

      <header className="mb-8 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight truncate">{person.name}</h1>

        {/* Delete person — uses AlertDialog instead of window.confirm */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive rounded-full shrink-0"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="w-5 h-5" />
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {person.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the person profile. Linked entries will remain but the link will be
                removed. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletePerson.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDelete}
                disabled={deletePerson.isPending}
              >
                {deletePerson.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </header>

      {/* Notes */}
      <div className="mb-10 animate-in fade-in duration-500">
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 block px-2">
          Personal Notes
        </label>
        <Textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={handleSaveNotes}
          placeholder="Add context, preferences, reminders…"
          className="min-h-[140px] bg-card border-border/50 text-base shadow-sm"
        />
      </div>

      {/* Linked entries */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150 fill-both">
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4 block px-2">
          Linked Entries ({person.entries?.length || 0})
        </label>

        {person.entries?.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2">No entries linked to this person yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {person.entries?.map(entry => {
              const isUnlinking = unlinkingId === entry.id;
              return (
                <div key={entry.id} className="bg-card border border-border/40 rounded-3xl p-5 shadow-sm">
                  <div className="flex justify-between items-start mb-2 gap-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium uppercase tracking-wider flex-wrap">
                      <span className="bg-secondary/80 px-2 py-0.5 rounded-md">{entry.category}</span>
                      <span>{formatDate(entry.createdAt)}</span>
                    </div>

                    {/* Unlink — always visible (not hover-only, for mobile) */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 transition-colors"
                          disabled={isUnlinking}
                          title="Unlink entry"
                        >
                          {isUnlinking
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Unlink className="w-4 h-4" />}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove link?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the connection between this entry and {person.name}.
                            The entry itself won't be deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleUnlink(entry.id)}>
                            Remove link
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  <p className="text-foreground leading-relaxed text-sm">{entry.content}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
