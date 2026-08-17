import { useState } from "react";
import { useListPeople, useCreatePerson, getListPeopleQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Users, ChevronRight, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function People() {
  const { data: people, isLoading, isError, refetch } = useListPeople();
  const createPerson = useCreatePerson();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    createPerson.mutate({ data: { name } }, {
      onSuccess: () => {
        setNewName("");
        setIsAdding(false);
        queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
      },
    });
  };

  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
      <header className="mb-8 px-2 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">People</h1>
          <p className="text-muted-foreground mt-1">Everyone you mention</p>
        </div>
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full w-10 h-10 shrink-0"
          onClick={() => setIsAdding(!isAdding)}
        >
          <Plus className={`w-5 h-5 transition-transform ${isAdding ? "rotate-45" : ""}`} />
        </Button>
      </header>

      {/* Add form */}
      {isAdding && (
        <div className="mb-6 p-4 bg-card border border-border/50 rounded-3xl flex gap-2 animate-in fade-in zoom-in-95 duration-200">
          <Input
            autoFocus
            placeholder="Name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            className="bg-transparent border-none shadow-none focus-visible:ring-0 px-2"
          />
          <Button
            onClick={handleAdd}
            className="rounded-full px-5 shrink-0"
            disabled={!newName.trim() || createPerson.isPending}
          >
            {createPerson.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
          </Button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
        </div>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/50" />
          <div>
            <p className="font-medium text-foreground mb-1">Couldn't load people</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
          </div>
          <Button variant="outline" className="rounded-full" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && people?.length === 0 && !isAdding && (
        <div className="text-center py-16 flex flex-col items-center">
          <div className="w-20 h-20 bg-secondary/50 rounded-full flex items-center justify-center mb-4">
            <Users className="w-8 h-8 text-muted-foreground/50" />
          </div>
          <p className="font-medium text-foreground mb-1">No people yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            People profiles are created manually — tap the + button or link someone from an Inbox entry.
          </p>
          <Button variant="outline" className="rounded-full" onClick={() => setIsAdding(true)}>
            Add someone
          </Button>
        </div>
      )}

      {/* People list */}
      {!isLoading && !isError && people && people.length > 0 && (
        <div className="flex flex-col gap-3">
          {people.map((person, i) => (
            <Link key={person.id} href={`/people/${person.id}`}>
              <div
                className="bg-card border border-border/40 rounded-3xl p-5 flex items-center justify-between hover:bg-accent/40 active:bg-accent/60 transition-colors group cursor-pointer animate-in slide-in-from-bottom-2 fade-in"
                style={{ animationDelay: `${i * 30}ms`, animationFillMode: "both" }}
              >
                <div className="min-w-0">
                  <h3 className="font-semibold text-lg text-foreground truncate">{person.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 tracking-wider uppercase font-medium">
                    Tap to view details
                  </p>
                </div>
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors shrink-0 ml-3">
                  <ChevronRight className="w-5 h-5" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
