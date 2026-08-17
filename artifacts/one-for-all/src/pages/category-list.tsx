import { useState } from "react";
import { useListEntries, useUpdateEntry, useDeleteEntry, getListEntriesQueryKey, getGetEntryStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

interface CategoryListProps {
  category: 'journal' | 'task' | 'idea' | 'log';
  title: string;
  description: string;
}

export default function CategoryList({ category, title, description }: CategoryListProps) {
  const { data: entries, isLoading } = useListEntries({ category });
  const updateEntry = useUpdateEntry();
  const deleteEntry = useDeleteEntry();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const toggleTask = (id: number, isDone: boolean) => {
    updateEntry.mutate(
      { id, data: { isTaskDone: isDone } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category }) });
        }
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteEntry.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category }) });
        queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() });
      }
    });
  };

  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
      <header className="mb-8 px-2">
        <h1 className="text-3xl font-semibold tracking-tight capitalize">{title}</h1>
        <p className="text-muted-foreground mt-1">{description}</p>
      </header>

      {isLoading ? (
        <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
      ) : entries?.length === 0 ? (
        <div className="text-center p-12 bg-card rounded-3xl border border-border/50 border-dashed">
          <p className="text-muted-foreground">No entries here yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {entries?.map((entry, i) => {
            const isExpanded = expandedId === entry.id;
            const isDone = entry.isTaskDone;
            
            return (
              <div 
                key={entry.id}
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                className={`bg-card border border-border/40 rounded-3xl p-4 transition-all duration-300 cursor-pointer animate-in slide-in-from-bottom-2 fade-in ${
                  isExpanded ? 'shadow-md' : 'hover:bg-accent/30'
                }`}
                style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
              >
                <div className="flex gap-4">
                  {category === 'task' && (
                    <div className="pt-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <Checkbox 
                        checked={isDone} 
                        onCheckedChange={(checked) => toggleTask(entry.id, !!checked)} 
                        className="rounded-full w-6 h-6"
                      />
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <p className={`text-foreground leading-relaxed transition-all ${!isExpanded ? 'line-clamp-2' : ''} ${isDone ? 'line-through text-muted-foreground' : ''}`}>
                      {entry.content}
                    </p>
                    
                    {/* Source attribution for split entries */}
                    {isExpanded && entry.sourceContent && (
                      <div className="mt-3 bg-secondary/40 rounded-xl px-3 py-2.5 border-l-2 border-muted-foreground/20">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1 font-medium">Split from capture</p>
                        <p className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-3">{entry.sourceContent}</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                      <span>{formatDate(entry.createdAt)}</span>
                      
                      {isExpanded && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="w-8 h-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(entry.id);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
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
