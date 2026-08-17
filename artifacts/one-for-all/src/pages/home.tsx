import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Mic, Square, PenLine, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { getMockTranscript, categorizeContent } from "@/lib/heuristics";
import { transcribeAudio, categorizeTexts } from "@/lib/ai-api";
import { useCreateEntry, useGetEntryStats, getGetEntryStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type TranscriptBadge = "real" | "mock" | "unavailable";

export default function Home() {
  const [mode, setMode] = useState<"idle" | "recording" | "transcribing" | "editing" | "text">("idle");
  const [content, setContent] = useState("");
  const [transcriptBadge, setTranscriptBadge] = useState<TranscriptBadge>("real");
  const [isSaving, setIsSaving] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [, setLocation] = useLocation();
  const createEntry = useCreateEntry();
  const { data: stats } = useGetEntryStats();
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if ((mode === "editing" || mode === "text") && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  // ── Recording ─────────────────────────────────────────────────────────────

  const doTranscription = async (blob: Blob) => {
    const result = await transcribeAudio(blob);
    if (result.source === "whisper" && result.transcript) {
      setContent(result.transcript);
      setTranscriptBadge("real");
    } else if (result.source === "unavailable") {
      // API key not configured — use mock with explanation
      setContent(getMockTranscript());
      setTranscriptBadge("unavailable");
    } else {
      // error — use mock silently
      setContent(getMockTranscript());
      setTranscriptBadge("mock");
    }
    setMode("editing");
  };

  const handleStartRecording = async () => {
    audioChunks.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunks.current, { type: mimeType });
        await doTranscription(blob);
      };

      mediaRecorder.current = recorder;
      recorder.start();
      setMode("recording");
    } catch (err) {
      console.error("Mic access denied", err);
      // Mic unavailable — set flag so handleStopRecording uses mock path
      mediaRecorder.current = null;
      setMode("recording");
    }
  };

  const handleStopRecording = () => {
    setMode("transcribing");
    if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
      // onstop handler (wired in handleStartRecording) calls doTranscription
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach(t => t.stop());
    } else {
      // Mic was never available — fall back to mock immediately
      setTimeout(() => {
        setContent(getMockTranscript());
        setTranscriptBadge("mock");
        setMode("editing");
      }, 800);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!content.trim()) return;
    setIsSaving(true);

    // Get AI category first; fall back to keyword heuristic if unavailable
    let suggestedCategory = categorizeContent(content); // immediate local fallback
    try {
      const { categories, source } = await categorizeTexts([content]);
      if (source !== "error" && categories[0]) {
        suggestedCategory = categories[0];
      }
    } catch {
      // keep heuristic
    }

    try {
      await createEntry.mutateAsync({
        data: {
          content,
          captureType: mode === "text" ? "text" : "voice",
          suggestedCategory,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() });
      setLocation("/inbox");
    } catch (err) {
      console.error("Save failed", err);
      setIsSaving(false);
    }
  };

  const isSubmitting = isSaving || createEntry.isPending;

  // ── Render ────────────────────────────────────────────────────────────────

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
            {/* Transcript badge — only shown after a voice recording */}
            {mode === "editing" && (
              <>
                {transcriptBadge === "real" && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-secondary/80 text-secondary-foreground rounded-full text-sm self-start">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span>Transcript — edit if needed</span>
                  </div>
                )}
                {transcriptBadge === "mock" && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-secondary/80 text-secondary-foreground rounded-full text-sm self-start">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span>Mock transcript — edit if needed</span>
                  </div>
                )}
                {transcriptBadge === "unavailable" && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-sm self-start">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Transcription unavailable — using placeholder, please edit</span>
                  </div>
                )}
              </>
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
                disabled={isSubmitting || !content.trim()}
              >
                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save to Inbox"}
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
