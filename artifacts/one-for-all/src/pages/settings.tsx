import { useListEntries, useListPeople, useDeleteEntry, useDeletePerson } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trash2, AlertTriangle, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Settings() {
  const { data: entries } = useListEntries();
  const { data: people } = useListPeople();
  const deleteEntry = useDeleteEntry();
  const deletePerson = useDeletePerson();
  const queryClient = useQueryClient();
  const [isClearing, setIsClearing] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  const handleClearData = async () => {
    setIsClearing(true);
    try {
      if (entries) {
        for (const e of entries) {
          await deleteEntry.mutateAsync({ id: e.id });
        }
      }
      if (people) {
        for (const p of people) {
          await deletePerson.mutateAsync({ id: p.id });
        }
      }
      queryClient.clear();
      window.location.href = "/";
    } catch (err) {
      console.error(err);
      setIsClearing(false);
      setConfirmStep(false);
    }
  };

  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
      <header className="mb-10 px-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      </header>

      <div className="flex flex-col gap-6">
        <div className="bg-card border border-border/50 rounded-3xl p-6 shadow-sm">
          <div className="flex items-start gap-4 text-muted-foreground">
            <Info className="w-6 h-6 shrink-0 text-primary mt-0.5" />
            <div className="text-sm leading-relaxed space-y-2">
              <p>
                <strong className="text-foreground">About One for All</strong>
              </p>
              <p>
                This is a personal capture application designed to be a quiet space for your thoughts. 
                Currently running as a demo MVP.
              </p>
              <p>
                <strong>Note:</strong> Audio recording uses your device microphone but transcription is simulated.
                Categorization is heuristic-based (keyword matching), not AI.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-destructive/5 border border-destructive/20 rounded-3xl p-6">
          <h2 className="text-lg font-semibold text-destructive flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5" /> Danger Zone
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Permanently delete all your entries and people records. This action cannot be undone.
          </p>

          {!confirmStep ? (
            <Button 
              variant="destructive" 
              className="rounded-full font-medium"
              onClick={() => setConfirmStep(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear all data
            </Button>
          ) : (
            <div className="flex flex-col gap-3 animate-in fade-in">
              <p className="text-sm font-bold text-destructive">Are you absolutely sure?</p>
              <div className="flex gap-3">
                <Button 
                  variant="destructive" 
                  className="rounded-full flex-1"
                  onClick={handleClearData}
                  disabled={isClearing}
                >
                  {isClearing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Yes, delete everything
                </Button>
                <Button 
                  variant="outline" 
                  className="rounded-full flex-1 border-destructive/20 hover:bg-destructive/10 text-foreground"
                  onClick={() => setConfirmStep(false)}
                  disabled={isClearing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
