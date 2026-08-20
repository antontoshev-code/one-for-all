import { useState, useRef, useEffect } from "react";
import {
  useListEntries,
  useUpdateEntry,
  useDeleteEntry,
  useCreateEntry,
  useGetEntryStats,
  useListPeople,
  useCreatePerson,
  useLinkPersonToEntry,
  getListEntriesQueryKey,
  getGetEntryStatsQueryKey,
  getListPeopleQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Check, X, UserPlus, Scissors, ChevronLeft,
  UserCheck, AlertCircle, Trash2, Pencil,
} from "lucide-react";
import { logEvent } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/utils";
import {
  categorizeContent,
  splitIntoChunks,
  detectNamesInChunk,
  type NameDetectionResult,
} from "@/lib/heuristics";
// categorizeTexts / detectPersonNames no longer needed — replaced by /api/ai/split

// ── Types ─────────────────────────────────────────────────────────────────

type Category = 'journal' | 'task' | 'idea' | 'log';

const CATEGORY_SUBTITLES: Record<Category, string> = {
  journal: 'thoughts & reflections',
  task: 'something to do',
  idea: 'a concept to explore',
  log: 'body, health & workouts',
};

/**
 * One person named in a piece, together with what the user decided about them.
 *
 * Previously a piece held a single name, so a capture mentioning Petya, Kalia
 * and Elena asked about Petya and silently dropped the rest. The decision has
 * to live per name, not per piece — you might link one, create another, and
 * ignore a third in the same sentence.
 */
interface PieceName {
  detection: NameDetectionResult;
  linkedPersonId: number | null;
  addAsNew: boolean;
  /** Short label typed when creating a new person, e.g. "Studentina". */
  descriptor: string;
}

interface SplitPiece {
  text: string;
  category: Category;
  accepted: boolean;
  names: PieceName[];
}

/** Wrap raw detections as undecided names. */
function asPieceNames(detections: NameDetectionResult[]): PieceName[] {
  return detections.map(detection => ({
    detection,
    linkedPersonId: null,
    addAsNew: false,
    descriptor: '',
  }));
}

/**
 * Turn the names Claude found into detections, matching each against the
 * people already known. Names Claude returns are deduplicated case-insensitively
 * so "Петя" twice in one sentence asks once.
 */
function resolveDetectedNames(
  detected: string[],
  people: { id: number; name: string; descriptor?: string | null }[],
): NameDetectionResult[] {
  const seen = new Set<string>();
  const results: NameDetectionResult[] = [];

  for (const name of detected) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const matches = people.filter(p => {
      const firstName = p.name.split(' ')[0].toLowerCase();
      return p.name.toLowerCase() === key || firstName === key;
    });

    if (matches.length > 1) results.push({ matchedPeople: matches });
    else if (matches.length === 1) results.push({ matchedPerson: matches[0] });
    else if (name.trim().length >= 2) results.push({ suggestedName: name.trim() });
  }

  return results;
}

// ── Inbox page ────────────────────────────────────────────────────────────

export default function Inbox() {
  const { data: entries, isLoading, isError, refetch } = useListEntries({ category: 'inbox' });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col h-screen px-6 pt-12 pb-24 items-center justify-center text-center gap-4">
        <AlertCircle className="w-10 h-10 text-muted-foreground/50" />
        <div>
          <p className="font-medium text-foreground mb-1">Couldn't load your Inbox</p>
          <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        </div>
        <Button variant="outline" className="rounded-full" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col h-screen px-6 pt-12 pb-24 items-center justify-center text-center">
        <div className="w-24 h-24 rounded-full bg-secondary/50 flex items-center justify-center mb-6">
          <Check className="w-10 h-10 text-muted-foreground/50" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Inbox Zero</h2>
        <p className="text-muted-foreground">You're all caught up. Take a deep breath.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
      <header className="mb-8 px-2">
        <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-muted-foreground mt-1">Process your recent captures</p>
      </header>
      <div className="flex flex-col gap-4">
        {entries.map((entry, index) => (
          <InboxCard key={entry.id} entry={entry} index={index} />
        ))}
      </div>
    </div>
  );
}

// ── InboxCard ─────────────────────────────────────────────────────────────

function InboxCard({ entry, index }: { entry: any; index: number }) {
  const updateEntry = useUpdateEntry();
  const deleteEntry = useDeleteEntry();
  const { toast } = useToast();
  const createEntry = useCreateEntry();
  const createPerson = useCreatePerson();
  const linkPerson = useLinkPersonToEntry();
  const { data: people } = useListPeople();
  const queryClient = useQueryClient();

  // Single-category flow
  const [isChangingCat, setIsChangingCat] = useState(false);
  // AI-overridden category suggestion (set when split returns 1 unit)
  const [localSuggestedCat, setLocalSuggestedCat] = useState<Category | null>(null);
  // Skip state
  const [isSkipped, setIsSkipped] = useState(false);

  /**
   * Names found in the capture as a whole.
   *
   * Name suggestions used to appear only after "Split into pieces", so a
   * capture accepted as one entry — the common case — offered nobody, and the
   * only way to record that Elena was mentioned was to remember and use Link
   * Person by hand. Detection belongs on the path people actually take.
   */
  const [captureNames, setCaptureNames] = useState<PieceName[]>([]);

  /**
   * Whether this capture reads as more than one thought.
   *
   * Splitting was a small grey link under a large Accept button, so the
   * obvious action was to file a recording covering three unrelated things as
   * one entry. When the capture is plainly multi-part the emphasis swaps:
   * splitting becomes the offered action and accepting whole stays available.
   *
   * The local sentence splitter decides, not the AI. This runs on every card
   * render and must be instant and free — the real split still asks Claude
   * once the user commits to it.
   */
  const looksMultiPart = splitIntoChunks(entry.content ?? "").length > 1;

  /**
   * Editing the capture text here, not only at the moment of recording.
   *
   * Transcription mistakes are usually noticed later — reading it back in the
   * Inbox, not in the two seconds after speaking. Until now the text was fixed
   * once it left the Home screen, so a mis-heard name could never be corrected
   * and, worse, could never teach the app anything. Fixing it here feeds the
   * same learning path as fixing it there.
   */
  const [isEditingText, setIsEditingText] = useState(false);
  const [draftText, setDraftText] = useState(entry.content ?? "");
  const [isSavingText, setIsSavingText] = useState(false);

  const saveText = async () => {
    const next = draftText.trim();
    const original = entry.content ?? "";
    if (!next || next === original) { setIsEditingText(false); return; }

    setIsSavingText(true);
    try {
      await updateEntry.mutateAsync({ id: entry.id, data: { content: next } });

      // Same signal as an edit made at capture time: the person who was there
      // telling us what was actually said. Fire-and-forget — improving future
      // transcription must never risk the correction itself.
      fetch("/api/vocabulary/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ original, edited: next }),
      }).catch(err => console.warn("[vocabulary] learn failed", err));

      invalidateAll();
      setIsEditingText(false);
    } catch (err) {
      console.error("Failed to save capture text", err);
    } finally {
      setIsSavingText(false);
    }
  };

  useEffect(() => {
    if (!entry.content) return;
    setCaptureNames(asPieceNames(detectNamesInChunk(entry.content, people || [])));
  }, [entry.content, people]);
  // Link person popover
  const [personSearch, setPersonSearch] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [isCreatingPerson, setIsCreatingPerson] = useState(false);
  // Split flow
  const [splitMode, setSplitMode] = useState<'off' | 'reviewing'>('off');
  const [splitPieces, setSplitPieces] = useState<SplitPiece[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSplitLoading, setIsSplitLoading] = useState(false);
  // Synchronous lock for confirm-split — prevents double-fire before re-render
  const confirmingRef = useRef(false);

  const invalidateAll = async () => {
    // refetchQueries (not invalidateQueries) ensures the network request completes
    // before we dismiss the split overlay — prevents stale entries re-appearing.
    await Promise.all([
      queryClient.refetchQueries({ queryKey: getListEntriesQueryKey({ category: 'inbox' }) }),
      queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() }),
    ]);
  };

  // ── Single-category actions ──────────────────────────────────────────────

  /**
   * Create and link everyone the user chose, before filing the entry.
   *
   * Awaited rather than fire-and-forget: the entry leaves the inbox on success,
   * so a link that lands afterwards would attach to a card the user can no
   * longer see to check.
   */
  const applyCaptureNames = async () => {
    for (const name of captureNames) {
      let personId = name.linkedPersonId;

      if (!personId && name.addAsNew && name.detection.suggestedName) {
        try {
          const np = await createPerson.mutateAsync({
            data: {
              name: name.detection.suggestedName,
              ...(name.descriptor ? { descriptor: name.descriptor } : {}),
            },
          });
          personId = np.id;
          queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
        } catch (err) {
          // One name failing must not cost the entry or the other names.
          console.error("Failed to create person", err);
        }
      }

      if (personId) {
        try {
          await linkPerson.mutateAsync({ id: entry.id, data: { personId } });
        } catch (err) {
          console.error("Failed to link person", err);
        }
      }
    }
  };

  const handleProcess = async (category: Category | 'inbox') => {
    await applyCaptureNames();

    updateEntry.mutate({ id: entry.id, data: { category } }, {
      onSuccess: () => {
        // Record for History (fire-and-forget — not on critical path)
        if (category !== 'inbox') {
          fetch('/api/captures', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: entry.content,
              captureType: entry.captureType,
              entries: [{ entryId: entry.id, category }],
            }),
          }).catch(err => console.warn('[History] Failed to record capture', err));
        }
        invalidateAll();
      },
    });
  };

  // ── Link person popover actions ──────────────────────────────────────────

  const handleLinkExistingPerson = (personId: number) => {
    linkPerson.mutate({ id: entry.id, data: { personId } }, {
      onSuccess: () => setPersonSearch(""),
    });
  };

  const handleCreateAndLink = async () => {
    const name = newPersonName.trim();
    if (!name) return;
    setIsCreatingPerson(true);
    try {
      const newPerson = await createPerson.mutateAsync({ data: { name } });
      await queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
      await linkPerson.mutateAsync({ id: entry.id, data: { personId: newPerson.id } });
      setNewPersonName("");
    } catch (e) {
      console.error("Failed to create & link person", e);
    } finally {
      setIsCreatingPerson(false);
    }
  };

  // ── Split actions ────────────────────────────────────────────────────────

  const handleInitSplit = async () => {
    if (!entry.content?.trim()) return;
    setIsSplitLoading(true);

    const makeFallbackPieces = () => {
      const chunks = splitIntoChunks(entry.content);
      return chunks.map(text => ({
        text,
        category: categorizeContent(text),
        accepted: true,
        names: asPieceNames(detectNamesInChunk(text, people || [])),
      }));
    };

    try {
      const res = await fetch('/api/ai/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: entry.content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json() as {
        units: Array<{ text: string; category: string; people: string[] }>;
        source: 'claude' | 'heuristic';
      };

      if (!data.units || data.units.length === 0) throw new Error('empty response');

      // Build SplitPieces for all units (including single-unit — user can still confirm)
      const pieces: SplitPiece[] = data.units.map(unit => {
        // Every name, not just the first that matched. The keyword scan is the
        // fallback for when the model returned none, not a second opinion.
        const detections = unit.people.length > 0
          ? resolveDetectedNames(unit.people, people || [])
          : detectNamesInChunk(unit.text, people || []);

        return {
          text: unit.text,
          category: unit.category as Category,
          accepted: true,
          names: asPieceNames(detections),
        };
      });

      setSplitPieces(pieces);
      setSplitMode('reviewing');
    } catch (err) {
      console.error('[split] falling back to heuristic:', err);
      const pieces = makeFallbackPieces();
      if (pieces.length === 1) {
        setLocalSuggestedCat(pieces[0].category);
      } else {
        setSplitPieces(pieces);
        setSplitMode('reviewing');
      }
    } finally {
      setIsSplitLoading(false);
    }
  };

  const updatePiece = (i: number, patch: Partial<SplitPiece>) => {
    setSplitPieces(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p));
  };

  const handleConfirmSplit = async () => {
    const accepted = splitPieces.filter(p => p.accepted);
    if (accepted.length === 0) return;
    if (confirmingRef.current) return;   // synchronous guard
    confirmingRef.current = true;        // set before first await
    setIsConfirming(true);
    try {
      const createdEntries: { entryId: number; category: string }[] = [];

      for (const piece of accepted) {
        // Resolve every name the user acted on. One sentence can link an
        // existing person and create a new one at the same time.
        const personIds: number[] = [];

        for (const name of piece.names) {
          if (name.linkedPersonId) {
            personIds.push(name.linkedPersonId);
            continue;
          }

          if (name.addAsNew && name.detection.suggestedName) {
            try {
              const np = await createPerson.mutateAsync({
                data: {
                  name: name.detection.suggestedName,
                  ...(name.descriptor ? { descriptor: name.descriptor } : {}),
                },
              });
              personIds.push(np.id);
              queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
            } catch (e) {
              // One name failing must not cost the entry or the other names.
              console.error("Failed to create person", e);
            }
          }
        }

        // Create the split entry
        const newEntry = await createEntry.mutateAsync({
          data: {
            content: piece.text,
            captureType: entry.captureType,
            category: piece.category,
            suggestedCategory: piece.category,
          }
        });

        createdEntries.push({ entryId: newEntry.id, category: piece.category });

        // Link everyone this piece resolved to.
        for (const personId of [...new Set(personIds)]) {
          try {
            await linkPerson.mutateAsync({ id: newEntry.id, data: { personId } });
          } catch (e) {
            console.error("Failed to link person", e);
          }
        }
      }

      // Record original capture for History before deleting it (fire-and-forget)
      fetch('/api/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: entry.content,
          captureType: entry.captureType,
          entries: createdEntries,
        }),
      }).catch(err => console.warn('[History] Failed to record capture', err));

      // Remove original from inbox — must happen before closing overlay
      await deleteEntry.mutateAsync({ id: entry.id });

      logEvent('capture_split', { pieces: accepted.length, entryId: entry.id });

      // Await the refetch so the list is already updated before we dismiss
      await invalidateAll();
      setSplitMode('off');
    } catch (e) {
      console.error("Split confirm failed", e);
      setIsConfirming(false);
      confirmingRef.current = false;  // release lock so user can retry
    }
    // Note: no finally on success path — component unmounts on navigation
  };

  const suggestedCat = (localSuggestedCat || entry.suggestedCategory || 'journal') as Category;
  const filteredPeople = people?.filter(p =>
    p.name.toLowerCase().includes(personSearch.toLowerCase())
  );
  const acceptedCount = splitPieces.filter(p => p.accepted).length;

  // ── Split review overlay ─────────────────────────────────────────────────

  if (splitMode === 'reviewing') {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-12 pb-4 border-b border-border/50 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => setSplitMode('off')}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">Split into pieces</h2>
            <p className="text-xs text-muted-foreground">Review and edit each piece before saving</p>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-5 max-w-2xl mx-auto w-full" style={{ paddingBottom: '7rem' }}>
          {/* Original capture quote */}
          <div className="bg-secondary/40 rounded-2xl p-4 mb-6 border-l-[3px] border-primary/40">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5 font-medium">Original capture</p>
            <p className="text-sm text-foreground/70 leading-relaxed">{entry.content}</p>
          </div>

          {/* Piece cards */}
          <div className="flex flex-col gap-3">
            {splitPieces.map((piece, i) => (
              <SplitPieceCard
                key={i}
                piece={piece}
                onToggleAccepted={() => updatePiece(i, { accepted: !piece.accepted })}
                onCategoryChange={(cat) => updatePiece(i, { category: cat })}
                onUpdateName={(nameIndex, patch) => setSplitPieces(prev => prev.map((p, idx) => idx === i
                  ? { ...p, names: p.names.map((n, ni) => ni === nameIndex ? { ...n, ...patch } : n) }
                  : p
                ))}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border/50 px-4 py-4 max-w-2xl mx-auto w-full">
          <Button
            className="w-full rounded-full h-11 bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50"
            disabled={acceptedCount === 0 || isConfirming}
            onClick={handleConfirmSplit}
          >
            {isConfirming && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {acceptedCount === 0
              ? 'Select at least one piece'
              : `Save ${acceptedCount} ${acceptedCount === 1 ? 'piece' : 'pieces'}`}
          </Button>
        </div>
      </div>
    );
  }

  // ── Normal card ──────────────────────────────────────────────────────────

  return (
    <div
      className="bg-card rounded-3xl p-5 shadow-sm border border-border/50 animate-in slide-in-from-bottom-4 fade-in"
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
    >
      <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground font-medium">
        <span>{formatDate(entry.createdAt)}</span>
        <span className="bg-secondary px-2 py-1 rounded-full uppercase tracking-widest text-[10px]">
          {entry.captureType}
        </span>
      </div>

      {isEditingText ? (
        <div className="mb-6 flex flex-col gap-2">
          <Textarea
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            autoFocus
            rows={5}
            className="text-lg leading-relaxed rounded-2xl"
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-xs"
              onClick={() => { setDraftText(entry.content ?? ""); setIsEditingText(false); }}
              disabled={isSavingText}
            >
              Cancel
            </Button>
            <Button size="sm" className="rounded-full text-xs" onClick={saveText} disabled={isSavingText}>
              {isSavingText && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-6 flex items-start gap-2">
          <p className="text-foreground text-lg leading-relaxed flex-1">{entry.content}</p>
          <button
            onClick={() => { setDraftText(entry.content ?? ""); setIsEditingText(true); }}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0 mt-1"
            aria-label="Fix the transcription"
            title="Fix a mis-heard word"
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>
      )}

      {isChangingCat ? (
        <div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {(['journal', 'task', 'idea', 'log'] as Category[]).map((cat) => (
              <button
                key={cat}
                className="flex flex-col items-start text-left rounded-2xl bg-card border border-border/50 px-3 py-2.5 hover:bg-accent/40 active:bg-accent/60 transition-colors"
                onClick={() => {
                  logEvent('suggestion_rejected', { suggested: suggestedCat, chosen: cat, entryId: entry.id });
                  handleProcess(cat);
                  setIsChangingCat(false);
                }}
              >
                <span className="text-sm font-semibold capitalize">{cat}</span>
                <span className="text-[10px] text-muted-foreground leading-tight">{CATEGORY_SUBTITLES[cat]}</span>
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="rounded-full w-full text-muted-foreground text-xs" onClick={() => setIsChangingCat(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="bg-secondary/30 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <SparkleIcon />
              Looks like a <span className="capitalize font-semibold text-primary">{suggestedCat}</span> entry
            </p>
          </div>

          {/* People named in this capture. Same decisions as the split screen,
              on the path most captures actually take. */}
          {captureNames.length > 0 && !isSkipped && (
            <div className="flex flex-col gap-2">
              {captureNames.map((name, ni) => {
                const patch = (p: Partial<PieceName>) =>
                  setCaptureNames(prev => prev.map((n, i) => i === ni ? { ...n, ...p } : n));
                const { detection } = name;

                if (detection.matchedPerson) {
                  const linked = name.linkedPersonId === detection.matchedPerson.id;
                  return (
                    <div key={ni} className="bg-background/60 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        Link to{' '}
                        <span className="font-semibold text-foreground">
                          {detection.matchedPerson.name}
                          {detection.matchedPerson.descriptor ? ` (${detection.matchedPerson.descriptor})` : ''}
                        </span>?
                      </span>
                      <button
                        onClick={() => patch({ linkedPersonId: linked ? null : detection.matchedPerson!.id })}
                        className={`text-xs shrink-0 ${linked ? 'text-muted-foreground' : 'text-primary font-medium'}`}
                      >
                        {linked ? 'Remove' : 'Link'}
                      </button>
                    </div>
                  );
                }

                if (detection.matchedPeople && detection.matchedPeople.length > 1) {
                  return (
                    <div key={ni} className="bg-background/60 rounded-xl px-3 py-2">
                      <p className="text-xs text-muted-foreground mb-1.5">
                        Mentions <span className="font-semibold text-foreground">{detection.matchedPeople[0].name}</span> — which one?
                      </p>
                      <div className="flex flex-col gap-1">
                        {detection.matchedPeople.map(p => (
                          <button
                            key={p.id}
                            onClick={() => patch({ linkedPersonId: name.linkedPersonId === p.id ? null : p.id })}
                            className={`text-left text-xs px-2 py-1 rounded-lg ${
                              name.linkedPersonId === p.id
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-background border border-border/40'
                            }`}
                          >
                            {p.name}{p.descriptor ? ` (${p.descriptor})` : ''}{name.linkedPersonId === p.id && ' ✓'}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }

                if (detection.suggestedName) {
                  return (
                    <div key={ni} className="bg-background/60 rounded-xl px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          Mentions <span className="font-semibold text-foreground">"{detection.suggestedName}"</span> — add as person?
                        </span>
                        <button
                          onClick={() => patch({ addAsNew: !name.addAsNew })}
                          className={`text-xs shrink-0 ${name.addAsNew ? 'text-muted-foreground' : 'text-primary font-medium'}`}
                        >
                          {name.addAsNew ? 'Undo' : 'Add'}
                        </button>
                      </div>
                      {(name.addAsNew || name.descriptor) && (
                        <Input
                          placeholder="Short label (optional): 'Studentina', 'climbing gym'…"
                          value={name.descriptor}
                          onChange={e => patch({ descriptor: e.target.value, addAsNew: true })}
                          className="h-7 text-xs rounded-xl mt-2"
                        />
                      )}
                    </div>
                  );
                }

                return null;
              })}
            </div>
          )}

          {isSkipped ? (
            <div className="flex items-center justify-between px-1">
              <p className="text-sm text-muted-foreground">Skipped — come back later</p>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full h-8 text-xs text-muted-foreground"
                onClick={() => setIsSkipped(false)}
              >
                Undo
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              {looksMultiPart ? (
                <Button
                  className="flex-1 rounded-full bg-foreground text-background hover:bg-foreground/90 h-10"
                  onClick={handleInitSplit}
                  disabled={isSplitLoading}
                >
                  {isSplitLoading
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <Scissors className="w-4 h-4 mr-2" />}
                  {isSplitLoading ? 'Analysing…' : 'Split into pieces'}
                </Button>
              ) : (
                <Button
                  className="flex-1 rounded-full bg-foreground text-background hover:bg-foreground/90 h-10"
                  onClick={() => {
                    logEvent('suggestion_accepted', { category: suggestedCat, entryId: entry.id });
                    handleProcess(suggestedCat as Category);
                  }}
                >
                  Accept
                </Button>
              )}
              <Button
                variant="outline"
                className="rounded-full h-10 px-4"
                onClick={() => setIsChangingCat(true)}
              >
                Change
              </Button>
              <Button
                variant="ghost"
                className="rounded-full h-10 px-4 text-muted-foreground"
                onClick={() => setIsSkipped(true)}
              >
                Skip
              </Button>
            </div>
          )}

          {looksMultiPart ? (
            <button
              onClick={() => {
                logEvent('suggestion_accepted', { category: suggestedCat, entryId: entry.id });
                handleProcess(suggestedCat as Category);
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              Keep it as one {suggestedCat} entry
            </button>
          ) : (
            <button
              onClick={handleInitSplit}
              disabled={isSplitLoading}
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSplitLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Scissors className="w-3 h-3" />}
              {isSplitLoading ? 'Analysing…' : 'Split into pieces'}
            </button>
          )}
        </div>
      )}

      {/* Link Person, and a way out */}
      <div className="mt-4 pt-4 border-t border-border/50 flex justify-between items-center">
        {/* There was no way to throw a capture away. Skip only hides it, so a
            test recording or a misfire stayed in the inbox for good. Undoable,
            so it needs no confirmation dialog of its own. */}
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full text-muted-foreground hover:text-destructive h-8 text-xs"
          onClick={async () => {
            try {
              await deleteEntry.mutateAsync({ id: entry.id });
              invalidateAll();
              toast({
                title: "Capture deleted",
                action: (
                  <ToastAction
                    altText="Undo"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/entries/${entry.id}/restore`, { method: "POST" });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        invalidateAll();
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
              toast({ title: "Could not delete", description: "Please try again." });
            }
          }}
        >
          <Trash2 className="w-3.5 h-3.5 mr-2" />
          Delete
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground h-8 text-xs">
              <UserPlus className="w-3.5 h-3.5 mr-2" />
              Link Person
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3 rounded-2xl">
            <p className="text-xs font-semibold mb-2 ml-1 text-muted-foreground uppercase tracking-wider">Select Person</p>

            {/* Inline create */}
            <div className="mb-2 flex gap-1.5">
              <Input
                placeholder="New person name…"
                value={newPersonName}
                onChange={e => setNewPersonName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateAndLink(); }}
                className="h-8 text-sm rounded-xl"
              />
              <Button
                size="sm"
                className="h-8 rounded-xl px-2.5 shrink-0"
                disabled={!newPersonName.trim() || isCreatingPerson}
                onClick={handleCreateAndLink}
              >
                {isCreatingPerson ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
              </Button>
            </div>

            {/* Existing people */}
            {people && people.length > 0 && (
              <>
                <div className="mb-1.5">
                  <Input
                    placeholder="Search…"
                    value={personSearch}
                    onChange={e => setPersonSearch(e.target.value)}
                    className="h-7 text-xs rounded-xl"
                  />
                </div>
                <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                  {filteredPeople?.map(p => (
                    <Button
                      key={p.id}
                      variant="ghost"
                      className="justify-start rounded-xl h-9 text-sm"
                      onClick={() => handleLinkExistingPerson(p.id)}
                    >
                      {p.name}{p.descriptor ? ` (${p.descriptor})` : ''}
                    </Button>
                  ))}
                  {filteredPeople?.length === 0 && (
                    <p className="text-xs text-muted-foreground p-2 text-center">No match</p>
                  )}
                </div>
              </>
            )}

            {!people?.length && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Type a name above to create someone.
              </p>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// ── SplitPieceCard ────────────────────────────────────────────────────────

interface SplitPieceCardProps {
  piece: SplitPiece;
  onToggleAccepted: () => void;
  onCategoryChange: (cat: Category) => void;
  onUpdateName: (nameIndex: number, patch: Partial<PieceName>) => void;
}

function SplitPieceCard({
  piece,
  onToggleAccepted,
  onCategoryChange,
  onUpdateName,
}: SplitPieceCardProps) {
  const categories: Category[] = ['journal', 'task', 'idea', 'log'];

  // Local state ensures immediate visual update on tap — not dependent on parent re-render timing
  const [selectedCategory, setSelectedCategory] = useState<Category>(piece.category);

  const handleCategoryClick = (cat: Category) => {
    setSelectedCategory(cat);
    onCategoryChange(cat);
  };

  return (
    <div className={`bg-card border border-border/50 rounded-2xl p-4 transition-opacity duration-200 ${!piece.accepted ? 'opacity-40' : ''}`}>
      {/* Text + accepted toggle */}
      <div className="flex items-start gap-3 mb-3">
        <p className="text-foreground leading-relaxed flex-1 text-[15px]">{piece.text}</p>
        <button
          onClick={onToggleAccepted}
          className={`shrink-0 w-6 h-6 mt-0.5 rounded-full border-2 flex items-center justify-center transition-colors ${
            piece.accepted
              ? 'bg-primary border-primary text-primary-foreground'
              : 'border-muted-foreground/30 hover:border-muted-foreground'
          }`}
          aria-label={piece.accepted ? 'Skip this piece' : 'Include this piece'}
        >
          {piece.accepted && <Check className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Category picker */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => handleCategoryClick(cat)}
            className={`flex flex-col items-center py-2 rounded-xl text-xs font-medium capitalize transition-colors ${
              selectedCategory === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
            }`}
          >
            <span className="font-semibold capitalize">{cat}</span>
            <span className={`text-[8px] leading-tight mt-0.5 text-center px-0.5 ${
              selectedCategory === cat ? 'text-primary-foreground/70' : 'text-muted-foreground/60'
            }`}>
              {CATEGORY_SUBTITLES[cat]}
            </span>
          </button>
        ))}
      </div>

      {/* One block per person named in this piece. */}
      {piece.names.map((name, ni) => {
        const { detection } = name;

        // Existing person, unambiguous match.
        if (detection.matchedPerson) {
          const linked = name.linkedPersonId === detection.matchedPerson.id;
          return (
            <div key={ni} className="bg-secondary/50 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground leading-tight">
                Link to{' '}
                <span className="font-semibold text-foreground">
                  {detection.matchedPerson.name}
                  {detection.matchedPerson.descriptor ? ` (${detection.matchedPerson.descriptor})` : ''}
                </span>
                ?
              </span>
              <button
                onClick={() => onUpdateName(ni, { linkedPersonId: linked ? null : detection.matchedPerson!.id })}
                className={`text-xs shrink-0 transition-colors ${
                  linked
                    ? 'text-muted-foreground hover:text-foreground'
                    : 'text-primary font-medium hover:text-primary/80'
                }`}
              >
                {linked ? 'Remove' : 'Link'}
              </button>
            </div>
          );
        }

        // Several people share this name — ask which.
        if (detection.matchedPeople && detection.matchedPeople.length > 1) {
          return (
            <div key={ni} className="bg-secondary/50 rounded-xl px-3 py-2.5">
              <p className="text-xs text-muted-foreground mb-2">
                Mentions{' '}
                <span className="font-semibold text-foreground">{detection.matchedPeople[0].name}</span>
                {' '}— which one?
              </p>
              <div className="flex flex-col gap-1">
                {detection.matchedPeople.map(p => (
                  <button
                    key={p.id}
                    onClick={() => onUpdateName(ni, {
                      linkedPersonId: name.linkedPersonId === p.id ? null : p.id,
                      addAsNew: false,
                    })}
                    className={`text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                      name.linkedPersonId === p.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-primary/10 text-foreground border border-border/40'
                    }`}
                  >
                    {p.name}{p.descriptor ? ` (${p.descriptor})` : ''}
                    {name.linkedPersonId === p.id && ' ✓'}
                  </button>
                ))}
                <button
                  onClick={() => onUpdateName(ni, {
                    detection: { suggestedName: detection.matchedPeople![0].name },
                    addAsNew: true,
                    linkedPersonId: null,
                  })}
                  className="text-left text-xs px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                >
                  + Add a different {detection.matchedPeople[0].name}
                </button>
              </div>
            </div>
          );
        }

        // Nobody by this name yet — offer to create one.
        if (detection.suggestedName) {
          return (
            <div key={ni} className="bg-secondary/50 rounded-xl px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground leading-tight">
                  Mentions{' '}
                  <span className="font-semibold text-foreground">"{detection.suggestedName}"</span>
                  {' '}— add as person?
                </span>
                <button
                  onClick={() => onUpdateName(ni, { addAsNew: !name.addAsNew })}
                  className={`text-xs shrink-0 transition-colors ${
                    name.addAsNew
                      ? 'text-muted-foreground hover:text-foreground'
                      : 'text-primary font-medium hover:text-primary/80'
                  }`}
                >
                  {name.addAsNew ? 'Undo' : 'Add'}
                </button>
              </div>

              {/* The label input stays mounted once anything has been typed, so
                  pressing Undo and changing your mind doesn't lose the text —
                  it reads as discarded otherwise, with no way back to it. */}
              {(name.addAsNew || name.descriptor) && (
                <Input
                  placeholder="Short label (optional): 'Studentina', 'climbing gym'…"
                  value={name.descriptor}
                  onChange={e => onUpdateName(ni, { descriptor: e.target.value, addAsNew: true })}
                  className="h-7 text-xs rounded-xl mt-2"
                />
              )}

              {!name.addAsNew && name.descriptor && (
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Not being added. Type above or press Add to include them.
                </p>
              )}
            </div>
          );
        }

        return null;
      })}

    </div>
  );
}

// ── SparkleIcon ───────────────────────────────────────────────────────────

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  );
}
