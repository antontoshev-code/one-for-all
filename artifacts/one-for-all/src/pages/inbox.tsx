import { useState } from "react";
import { useListEntries, useUpdateEntry, useGetEntryStats, getListEntriesQueryKey, getGetEntryStatsQueryKey, useLinkPersonToEntry, useListPeople } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowRight, UserPlus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

export default function Inbox() {
  const { data: entries, isLoading } = useListEntries({ category: 'inbox' });
  const updateEntry = useUpdateEntry();
  const queryClient = useQueryClient();

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
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

function InboxCard({ entry, index }: { entry: any, index: number }) {
  const updateEntry = useUpdateEntry();
  const linkPerson = useLinkPersonToEntry();
  const { data: people } = useListPeople();
  const queryClient = useQueryClient();
  const [isChangingCat, setIsChangingCat] = useState(false);
  const [personSearch, setPersonSearch] = useState("");

  const handleProcess = (category: 'journal'|'task'|'idea'|'log' | 'inbox') => {
    updateEntry.mutate(
      { id: entry.id, data: { category } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category: 'inbox' }) });
          queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() });
        }
      }
    );
  };

  const handleLinkPerson = (personId: number) => {
    linkPerson.mutate({ id: entry.id, data: { personId } }, {
      onSuccess: () => {
        setPersonSearch("");
      }
    });
  };

  const suggestedCat = entry.suggestedCategory || 'journal';

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
          {['journal', 'task', 'idea', 'log'].map((cat) => (
            <Button
              key={cat}
              variant="secondary"
              size="sm"
              className="rounded-full bg-background"
              onClick={() => {
                handleProcess(cat as any);
                setIsChangingCat(false);
              }}
            >
              {cat}
            </Button>
          ))}
          <Button variant="ghost" size="icon" className="rounded-full shrink-0" onClick={() => setIsChangingCat(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div className="bg-secondary/30 rounded-2xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <SparkleIcon />
              Looks like a <span className="capitalize font-semibold text-primary">{suggestedCat}</span> entry
            </p>
          </div>
          
          <div className="flex gap-2">
            <Button 
              className="flex-1 rounded-full bg-foreground text-background hover:bg-foreground/90 h-10"
              onClick={() => handleProcess(suggestedCat as any)}
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
              onClick={() => handleProcess('inbox')}
            >
              Skip
            </Button>
          </div>
        </div>
      )}

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
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {people?.map(p => (
                <Button key={p.id} variant="ghost" className="justify-start rounded-xl h-10" onClick={() => handleLinkPerson(p.id)}>
                  {p.name}
                </Button>
              ))}
              {!people?.length && (
                <p className="text-sm text-muted-foreground p-2 text-center">No people created yet. Create them in the People tab.</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
  );
}
