import { useState } from "react";
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
  CheckCheck, UserCheck,
} from "lucide-react";
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

// ── Types ─────────────────────────────────────────────────────────────────

type Category = 'journal' | 'task' | 'idea' | 'log';

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
  const { data: entries, isLoading } = useListEntries({ category: 'inbox' });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
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

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category: 'inbox' }) }),
      queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() }),
    ]);
  };

  // ── Single-category actions ──────────────────────────────────────────────

  const handleProcess = (category: Category | 'inbox') => {
    updateEntry.mutate({ id: entry.id, data: { category } }, { onSuccess: invalidateAll });
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

  const handleInitSplit = () => {
    const chunks = splitIntoChunks(entry.content);
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
    setIsConfirming(true);
    try {
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

        // Link person if we have one
        if (personId) {
          await linkPerson.mutateAsync({ id: newEntry.id, data: { personId } });
        }
      }

      // Remove original from inbox — must happen before closing overlay
      await deleteEntry.mutateAsync({ id: entry.id });

      // Await the refetch so the list is already updated before we dismiss
      await invalidateAll();
      setSplitMode('off');
    } catch (e) {
      console.error("Split confirm failed", e);
      setIsConfirming(false);
    }
    // Note: no finally — success path sets isConfirming via component unmount
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
        <div className="bg-secondary/50 rounded-2xl p-2 flex gap-2 overflow-x-auto no-scrollbar">
          {(['journal', 'task', 'idea', 'log'] as Category[]).map((cat) => (
            <Button
              key={cat}
              variant="secondary"
              size="sm"
              className="rounded-full bg-background"
              onClick={() => { handleProcess(cat); setIsChangingCat(false); }}
            >
              {cat}
            </Button>
          ))}
          <Button variant="ghost" size="icon" className="rounded-full shrink-0" onClick={() => setIsChangingCat(false)}>
            <X className="w-4 h-4" />
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
                onClick={() => handleProcess(suggestedCat as Category)}
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
            className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <Scissors className="w-3 h-3" />
            Split into pieces
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

      {/* Category picker — selectedCategory drives highlight; onCategoryChange keeps parent in sync */}
      <div className="flex gap-1.5 flex-wrap mb-3">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => handleCategoryClick(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
              selectedCategory === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
            }`}
          >
            {cat}
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
