import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Loader2, Mic, PenLine, AlertCircle, Clock, User, UserPlus, X } from "lucide-react";
import { useListPeople } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────

interface HistoryPerson {
  id: number;
  name: string;
}

interface HistoryEntry {
  entryId: number | null;
  category: string;
  content: string | null;
  exists: boolean;
  people: HistoryPerson[];
}

interface HistoryCapture {
  id: number;
  content: string;
  captureType: "voice" | "text";
  createdAt: string;
  entries: HistoryEntry[];
}


/**
 * Add or remove the people linked to one entry, from History.
 *
 * There was nowhere to do this once a capture had been processed. Names are
 * offered while a capture sits in the Inbox and never again, so missing one —
 * which happens, since detection is deliberately cautious — meant it stayed
 * missing. History is where you go when you remember, so this is where the fix
 * belongs.
 *
 * Scoped to the single entry rather than the whole capture: a capture split
 * into a workout and an evening with friends should not attach those friends to
 * the workout.
 */
function EntryPeopleEditor({
  entryId,
  people,
  onChanged,
}: {
  entryId: number;
  people: HistoryPerson[];
  onChanged: () => void;
}) {
  const { data: allPeople } = useListPeople();
  const [busy, setBusy] = useState(false);

  const linkedIds = new Set(people.map(p => p.id));
  const available = (allPeople ?? []).filter(p => !linkedIds.has(p.id));

  const call = async (url: string, method: string) => {
    setBusy(true);
    try {
      const res = await fetch(url, { method });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChanged();
    } catch (err) {
      console.error("Failed to update entry people", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PopoverContent className="w-64 p-3 rounded-2xl">
      <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">
        People in this entry
      </p>

      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-3">Nobody linked yet.</p>
      ) : (
        <div className="flex flex-col gap-1 mb-3">
          {people.map(person => (
            <div key={person.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{person.name}</span>
              <button
                disabled={busy}
                onClick={() => call(`/api/entries/${entryId}/people/${person.id}`, "DELETE")}
                className="text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-50"
                aria-label={`Remove ${person.name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <>
          <p className="text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wider">
            Add
          </p>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {available.map(person => (
              <button
                key={person.id}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  fetch(`/api/entries/${entryId}/people`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ personId: person.id }),
                  })
                    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); onChanged(); })
                    .catch(err => console.error("Failed to link person", err))
                    .finally(() => setBusy(false));
                }}
                className="text-left text-sm px-2 py-1 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50 truncate"
              >
                {person.name}
                {person.descriptor ? (
                  <span className="text-muted-foreground"> ({person.descriptor})</span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      )}
    </PopoverContent>
  );
}

// ── Category → page route ─────────────────────────────────────────────────

const CATEGORY_ROUTE: Record<string, string> = {
  journal: "/journal",
  task: "/tasks",
  idea: "/ideas",
  log: "/log",
  inbox: "/inbox",
};

// ── Category badge colours ─────────────────────────────────────────────────

const CATEGORY_COLOUR: Record<string, string> = {
  journal: "bg-sky-100 text-sky-700",
  task:    "bg-amber-100 text-amber-700",
  idea:    "bg-violet-100 text-violet-700",
  log:     "bg-emerald-100 text-emerald-700",
  inbox:   "bg-secondary text-secondary-foreground",
};

// ── Component ─────────────────────────────────────────────────────────────

export default function History() {
  const [captures, setCaptures] = useState<HistoryCapture[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  const load = () => {
    setIsLoading(true);
    setIsError(false);
    fetch("/api/captures")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: HistoryCapture[]) => setCaptures(data))
      .catch(() => setIsError(true))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { load(); }, []);

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
        <header className="mb-8 px-2">
          <h1 className="text-3xl font-semibold tracking-tight">History</h1>
          <p className="text-muted-foreground mt-1">Every original capture, preserved</p>
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
          <h1 className="text-3xl font-semibold tracking-tight">History</h1>
          <p className="text-muted-foreground mt-1">Every original capture, preserved</p>
        </header>
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/50" />
          <div>
            <p className="font-medium text-foreground mb-1">Couldn't load history</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
          </div>
          <Button variant="outline" className="rounded-full" onClick={load}>Retry</Button>
        </div>
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────

  if (captures.length === 0) {
    return (
      <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
        <header className="mb-8 px-2">
          <h1 className="text-3xl font-semibold tracking-tight">History</h1>
          <p className="text-muted-foreground mt-1">Every original capture, preserved</p>
        </header>
        <div className="flex flex-col items-center text-center py-16 px-6 bg-card rounded-3xl border border-border/50 border-dashed">
          <Clock className="w-10 h-10 text-muted-foreground/30 mb-4" />
          <p className="font-medium text-foreground mb-1">No history yet</p>
          <p className="text-sm text-muted-foreground">
            Captures appear here after you accept or split them from the Inbox.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
      <header className="mb-8 px-2">
        <h1 className="text-3xl font-semibold tracking-tight">History</h1>
        <p className="text-muted-foreground mt-1">Every original capture, preserved</p>
      </header>

      <div className="flex flex-col gap-4">
        {captures.map((capture, i) => {
          const isSplit = capture.entries.length > 1;

          // Deduplicate people across all entries in this capture
          const allPeopleMap = new Map<number, string>();
          for (const entry of capture.entries) {
            for (const person of entry.people ?? []) {
              allPeopleMap.set(person.id, person.name);
            }
          }
          const allPeople = Array.from(allPeopleMap.entries()).map(([id, name]) => ({ id, name }));

          return (
            <div
              key={capture.id}
              className="bg-card border border-border/40 rounded-3xl p-5 shadow-sm animate-in slide-in-from-bottom-2 fade-in"
              style={{ animationDelay: `${i * 25}ms`, animationFillMode: "both" }}
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground font-medium">
                <span>{formatDate(capture.createdAt)}</span>
                <span className="flex items-center gap-1.5 bg-secondary/70 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  {capture.captureType === "voice"
                    ? <Mic className="w-3 h-3" />
                    : <PenLine className="w-3 h-3" />}
                  {capture.captureType}
                </span>
              </div>

              {/* Original text */}
              <p className="text-foreground leading-relaxed mb-4 text-[15px]">
                {capture.content}
              </p>

              {/* Result row — category chips */}
              <div className="pt-3 border-t border-border/30">
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">
                  {isSplit
                    ? `→ Split into ${capture.entries.length} pieces`
                    : "→ Saved as"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {capture.entries.map((entry, j) => {
                    const colourClass = CATEGORY_COLOUR[entry.category] ?? "bg-secondary text-secondary-foreground";
                    const route = CATEGORY_ROUTE[entry.category];
                    const label = <span className="capitalize font-medium">{entry.category}</span>;

                    if (!entry.exists || !route) {
                      return (
                        <span
                          key={j}
                          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full opacity-50 ${colourClass}`}
                          title="This entry was later deleted"
                        >
                          {label}
                          <span className="text-[9px]">(deleted)</span>
                        </span>
                      );
                    }

                    return (
                      <span key={j} className="inline-flex items-center gap-1">
                        <Link href={route}>
                          <span className={`inline-flex items-center text-xs px-2.5 py-1 rounded-full hover:opacity-80 transition-opacity cursor-pointer ${colourClass}`}>
                            {label}
                          </span>
                        </Link>
                        {entry.entryId !== null && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full"
                                aria-label={`Edit people in this ${entry.category} entry`}
                                title="Add or remove people"
                              >
                                <UserPlus className="w-3 h-3" />
                              </button>
                            </PopoverTrigger>
                            <EntryPeopleEditor
                              entryId={entry.entryId}
                              people={entry.people ?? []}
                              onChanged={load}
                            />
                          </Popover>
                        )}
                      </span>
                    );
                  })}
                </div>

                {/* People chips */}
                {allPeople.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {allPeople.map(person => (
                      <Link key={person.id} href={`/people/${person.id}`}>
                        <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 hover:opacity-80 transition-opacity cursor-pointer">
                          <User className="w-2.5 h-2.5" />
                          {person.name}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
