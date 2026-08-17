import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Mic, Square, PenLine, Loader2, Sparkles } from "lucide-react";
import { getMockTranscript, categorizeContent } from "@/lib/heuristics";
import { useCreateEntry, useGetEntryStats, getGetEntryStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function Home() {
  const [mode, setMode] = useState<"idle" | "recording" | "transcribing" | "editing" | "text">("idle");
  const [content, setContent] = useState("");
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const [, setLocation] = useLocation();
  const createEntry = useCreateEntry();
  const { data: stats } = useGetEntryStats();
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if ((mode === 'editing' || mode === 'text') && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      recorder.start();
      setMode("recording");
    } catch (err) {
      console.error("Mic access denied", err);
      // Fallback to mock flow if mic fails
      setMode("recording");
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach(t => t.stop());
    }
    setMode("transcribing");
    setTimeout(() => {
      setContent(getMockTranscript());
      setMode("editing");
    }, 1500);
  };

  const handleSave = () => {
    if (!content.trim()) return;
    const suggestedCategory = categorizeContent(content);
    createEntry.mutate(
      { data: { content, captureType: mode === 'text' ? 'text' : 'voice', suggestedCategory } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() });
          setLocation("/inbox");
        }
      }
    );
  };

  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-6 pt-12">
      <header className="mb-12">
        <h1 className="text-3xl font-semibold tracking-tight">Capture</h1>
        <p className="text-muted-foreground mt-1">What's on your mind?</p>
      </header>

      <main className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        {mode === "idle" && (
          <div className="flex flex-col items-center gap-8 animate-in fade-in zoom-in duration-500">
            <button
              onClick={handleStartRecording}
              className="relative group flex items-center justify-center w-40 h-40 rounded-full bg-primary text-primary-foreground shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-300"
            >
              <div className="absolute inset-0 rounded-full bg-primary/20 scale-[1.3] opacity-0 group-hover:opacity-100 group-hover:scale-[1.5] transition-all duration-700" />
              <div className="absolute inset-0 rounded-full bg-primary/10 scale-[1.6] opacity-0 group-hover:opacity-100 group-hover:scale-[1.8] transition-all duration-1000 delay-75" />
              <Mic className="w-16 h-16 relative z-10" />
            </button>

            <Button
              variant="secondary"
              size="lg"
              className="w-full max-w-[200px] rounded-full h-14 text-base shadow-sm"
              onClick={() => setMode("text")}
            >
              <PenLine className="w-5 h-5 mr-2" />
              Write instead
            </Button>
          </div>
        )}

        {mode === "recording" && (
          <div className="flex flex-col items-center gap-12 animate-in fade-in zoom-in">
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-destructive/10 text-destructive relative">
                <div className="absolute inset-0 rounded-full border-4 border-destructive/30 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
                <Mic className="w-10 h-10 animate-pulse" />
              </div>
              <p className="text-lg font-medium text-foreground">Listening...</p>
            </div>
            
            <button
              onClick={handleStopRecording}
              className="flex items-center justify-center w-20 h-20 rounded-full bg-foreground text-background shadow-lg hover:scale-105 active:scale-95 transition-all"
            >
              <Square className="w-8 h-8 fill-current" />
            </button>
          </div>
        )}

        {mode === "transcribing" && (
          <div className="flex flex-col items-center gap-6 animate-in fade-in">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-lg font-medium text-muted-foreground">Transcribing your thoughts...</p>
          </div>
        )}

        {(mode === "editing" || mode === "text") && (
          <div className="flex flex-col gap-4 animate-in slide-in-from-bottom-8 fade-in duration-300 w-full">
            {mode === "editing" && (
              <div className="flex items-center gap-2 px-4 py-2 bg-secondary/80 text-secondary-foreground rounded-full text-sm self-start">
                <Sparkles className="w-4 h-4 text-primary" />
                <span>Mock transcript — edit if needed</span>
              </div>
            )}
            
            <Textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Start typing..."
              className="min-h-[200px] text-lg leading-relaxed shadow-sm bg-card border-none"
            />
            
            <div className="flex gap-3">
              <Button
                variant="ghost"
                size="lg"
                className="flex-1 rounded-full h-14"
                onClick={() => {
                  setMode("idle");
                  setContent("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="lg"
                className="flex-1 rounded-full h-14 text-base shadow-md"
                onClick={handleSave}
                disabled={createEntry.isPending || !content.trim()}
              >
                {createEntry.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save to Inbox"}
              </Button>
            </div>
          </div>
        )}
      </main>

      {mode === "idle" && (
        <div className="mt-12 grid grid-cols-4 gap-2 text-center opacity-70">
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl font-medium">{stats?.journal || 0}</span>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Journal</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl font-medium">{stats?.task || 0}</span>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Tasks</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl font-medium">{stats?.idea || 0}</span>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Ideas</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl font-medium">{stats?.log || 0}</span>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Log</span>
          </div>
        </div>
      )}
    </div>
  );
}
