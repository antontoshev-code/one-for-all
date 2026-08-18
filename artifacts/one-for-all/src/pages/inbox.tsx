import { useState, useRef } from "react";
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
  CheckCheck, UserCheck, AlertCircle,
} from "lucide-react";
import { logEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/utils";
import {
  categorizeContent,
  splitIntoChunks,
  detectNamesInChunk,
  type NameDetectionResult,
} from "@/lib/heuristics";
import { categorizeTexts, detectPersonNames } from "@/lib/ai-api";

// ── Types ─────────────────────────────────────────────────────────────────

type Category = 'journal' | 'task' | 'idea' | 'log';

const CATEGORY_SUBTITLES: Record<Category, string> = {
  journal: 'thoughts & reflections',
  task: 'something to do',
  idea: 'a concept to explore',
  log: 'body, health & workouts',
};

interface SplitPiece {
  text: string;
  category: Category;
  accepted: boolean;
  nameDetection: NameDetectionResult;
  linkedPersonId: number | null;
  addAsNewPerson: boolean;
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
  const createEntry = useCreateEntry();
  const createPerson = useCreatePerson();
  const linkPerson = useLinkPersonToEntry();
  const { data: people } = useListPeople();
  const queryClient = useQueryClient();

  // Single-category flow
  const [isChangingCat, setIsChangingCat] = useState(false);
  // Skip state
  const [isSkipped, setIsSkipped] = useState(false);
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category: 'inbox' }) }),
      queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() }),
    ]);
  };

  // ── Single-category actions ──────────────────────────────────────────────

  const handleProcess = (category: Category | 'inbox') => {
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
    const chunks = splitIntoChunks(entry.content);
    if (chunks.length === 0) return;
    setIsSplitLoading(true);

    try {
      // Run AI categorization and AI name detection in parallel
      const [catResult, namesResult] = await Promise.allSettled([
        categorizeTexts(chunks),
        detectPersonNames(chunks),
      ]);

      const categories = catResult.status === 'fulfilled'
        ? catResult.value.categories
        : chunks.map(t => categorizeContent(t));

      const aiNames = namesResult.status === 'fulfilled'
        ? namesResult.value.names
        : null;

      const pieces: SplitPiece[] = chunks.map((text, i) => {
        // For name detection: if AI returned a name, resolve against existing people;
        // otherwise fall back to the keyword-based heuristic.
        let nameDetection: NameDetectionResult;
        const aiName = aiNames?.[i];
        if (aiName) {
          const matched = (people || []).find(p => {
            const fn = p.name.split(' ')[0].toLowerCase();
            return (
              p.name.toLowerCase() === aiName.toLowerCase() ||
              fn === aiName.toLowerCase().split(' ')[0]
            );
          });
          nameDetection = matched
            ? { matchedPerson: matched }
            : { suggestedName: aiName };
        } else {
          nameDetection = detectNamesInChunk(text, people || []);
        }

        return {
          text,
          category: categories[i] ?? categorizeContent(text),
          accepted: true,
          nameDetection,
          linkedPersonId: null,
          addAsNewPerson: false,
        };
      });

      setSplitPieces(pieces);
      setSplitMode('reviewing');
    } catch {
      // Complete failure — build pieces with heuristics
      const pieces: SplitPiece[] = chunks.map(text => ({
        text,
        category: categorizeContent(text),
        accepted: true,
        nameDetection: detectNamesInChunk(text, people || []),
        linkedPersonId: null,
        addAsNewPerson: false,
      }));
      setSplitPieces(pieces);
      setSplitMode('reviewing');
    } finally {
      setIsSplitLoading(false);
    }
  };

  const updatePiece = (i: number, patch: Partial<SplitPiece>) => {
    setSplitPieces(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p));
  };

  const handleAcceptAll = () => {
    setSplitPieces(prev => prev.map(p => ({ ...p, accepted: true })));
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
        let personId = piece.linkedPersonId;

        // Create new person if requested
        if (piece.addAsNewPerson && piece.nameDetection.suggestedName) {
          try {
            const np = await createPerson.mutateAsync({
              data: { name: piece.nameDetection.suggestedName }
            });
            personId = np.id;
            queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
          } catch (e) {
            console.error("Failed to create person", e);
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

        // Link person if we have one
        if (personId) {
          await linkPerson.mutateAsync({ id: newEntry.id, data: { personId } });
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

  const suggestedCat = entry.suggestedCategory || 'journal';
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
                onLinkPerson={(personId) => updatePiece(i, { linkedPersonId: personId })}
                onUnlinkPerson={() => updatePiece(i, { linkedPersonId: null })}
                onToggleAddNewPerson={(add) => updatePiece(i, { addAsNewPerson: add })}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border/50 px-4 py-4 max-w-2xl mx-auto w-full flex gap-3">
          <Button
            variant="outline"
            className="rounded-full h-11 flex-none"
            onClick={handleAcceptAll}
          >
            <CheckCheck className="w-4 h-4 mr-2" />
            Accept All
          </Button>
          <Button
            className="flex-1 rounded-full h-11 bg-foreground text-background hover:bg-foreground/90"
            disabled={acceptedCount === 0 || isConfirming}
            onClick={handleConfirmSplit}
          >
            {isConfirming
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : null}
            Confirm {acceptedCount} {acceptedCount === 1 ? 'piece' : 'pieces'}
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

      <p className="text-foreground text-lg leading-relaxed mb-6">{entry.content}</p>

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
              <Button
                className="flex-1 rounded-full bg-foreground text-background hover:bg-foreground/90 h-10"
                onClick={() => {
                  logEvent('suggestion_accepted', { category: suggestedCat, entryId: entry.id });
                  handleProcess(suggestedCat as Category);
                }}
              >
                Accept
              </Button>
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

          <button
            onClick={handleInitSplit}
            disabled={isSplitLoading}
            className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSplitLoading
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Scissors className="w-3 h-3" />}
            {isSplitLoading ? 'Analyzing…' : 'Split into pieces'}
          </button>
        </div>
      )}

      {/* Link Person */}
      <div className="mt-4 pt-4 border-t border-border/50 flex justify-end">
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
                      {p.name}
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
  onLinkPerson: (id: number) => void;
  onUnlinkPerson: () => void;
  onToggleAddNewPerson: (add: boolean) => void;
}

function SplitPieceCard({
  piece,
  onToggleAccepted,
  onCategoryChange,
  onLinkPerson,
  onUnlinkPerson,
  onToggleAddNewPerson,
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

      {/* Matched existing person suggestion */}
      {piece.nameDetection.matchedPerson && (
        <div className="bg-secondary/50 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground leading-tight">
            Link to{' '}
            <span className="font-semibold text-foreground">
              {piece.nameDetection.matchedPerson.name}
            </span>
            ?
          </span>
          {piece.linkedPersonId === piece.nameDetection.matchedPerson.id ? (
            <button
              onClick={onUnlinkPerson}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              Remove
            </button>
          ) : (
            <button
              onClick={() => onLinkPerson(piece.nameDetection.matchedPerson!.id)}
              className="text-xs text-primary font-medium hover:text-primary/80 transition-colors shrink-0"
            >
              Link
            </button>
          )}
        </div>
      )}

      {/* Suggested new person */}
      {piece.nameDetection.suggestedName && !piece.nameDetection.matchedPerson && (
        <div className="bg-secondary/50 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground leading-tight">
            Mentions{' '}
            <span className="font-semibold text-foreground">
              "{piece.nameDetection.suggestedName}"
            </span>
            {' '}— add as person?
          </span>
          {piece.addAsNewPerson ? (
            <button
              onClick={() => onToggleAddNewPerson(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              Undo
            </button>
          ) : (
            <button
              onClick={() => onToggleAddNewPerson(true)}
              className="text-xs text-primary font-medium hover:text-primary/80 transition-colors shrink-0"
            >
              Add
            </button>
          )}
        </div>
      )}
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
