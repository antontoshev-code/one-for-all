import { useState, useEffect, useRef } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetPerson, useUpdatePerson, useDeletePerson, getGetPersonQueryKey, useUnlinkPersonFromEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowLeft, Trash2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";

export default function PersonDetail() {
  const { id } = useParams();
  const personId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  const { data: person, isLoading } = useGetPerson(personId);
  const updatePerson = useUpdatePerson();
  const deletePerson = useDeletePerson();
  const unlinkPerson = useUnlinkPersonFromEntry();

  const [notes, setNotes] = useState("");
  const initRef = useRef<number | null>(null);

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
        onSuccess: (data) => {
          queryClient.setQueryData(getGetPersonQueryKey(person.id), (old: any) => 
            old ? { ...old, notes: data.notes } : old
          );
        }
      }
    );
  };

  const handleDelete = () => {
    if (!person) return;
    if (confirm(`Delete ${person.name}? Linked entries will remain but the link will be removed.`)) {
      deletePerson.mutate({ id: person.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/people'] });
          setLocation("/people");
        }
      });
    }
  };

  const handleUnlink = (entryId: number) => {
    unlinkPerson.mutate({ id: entryId, personId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPersonQueryKey(personId) });
      }
    });
  };

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!person) return <div className="p-8 text-center">Person not found</div>;

  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-8 max-w-2xl mx-auto w-full">
      <Link href="/people" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors w-max">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </Link>

      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">{person.name}</h1>
        <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive rounded-full" onClick={handleDelete}>
          <Trash2 className="w-5 h-5" />
        </Button>
      </header>

      <div className="mb-10 animate-in fade-in duration-500">
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 block px-2">Personal Notes</label>
        <div className="relative">
          <Textarea 
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={handleSaveNotes}
            placeholder="Add context, preferences, reminders..."
            className="min-h-[160px] bg-card border-border/50 text-base shadow-sm"
          />
        </div>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150 fill-both">
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4 block px-2">Linked Entries ({person.entries?.length || 0})</label>
        
        {person.entries?.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2">No entries linked to this person yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {person.entries?.map((entry) => (
              <div key={entry.id} className="bg-card border border-border/40 rounded-3xl p-5 shadow-sm group">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    <span className="bg-secondary/80 px-2 py-0.5 rounded-md">{entry.category}</span>
                    <span>{formatDate(entry.createdAt)}</span>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="w-8 h-8 rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleUnlink(entry.id)}
                    title="Unlink entry"
                  >
                    <Unlink className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-foreground leading-relaxed">{entry.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
