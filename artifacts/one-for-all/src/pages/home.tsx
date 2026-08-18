import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Mic, Square, PenLine, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { transcribeAudio } from "@/lib/ai-api";
import { logEvent } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";
import { useCreateEntry, useUpdateEntry, useGetEntryStats, getGetEntryStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type TranscriptBadge = "real" | "unavailable";

// Browser-native speech recognition (Chrome, Edge, Safari 15+)
// Minimal type shim — not in all tsconfig libs
interface WebSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type WebSpeechRecognitionCtor = new () => WebSpeechRecognition;
const SpeechRecognitionAPI: WebSpeechRecognitionCtor | null =
  (typeof window !== "undefined" &&
    ((window as unknown as { SpeechRecognition?: WebSpeechRecognitionCtor }).SpeechRecognition ||
     (window as unknown as { webkitSpeechRecognition?: WebSpeechRecognitionCtor }).webkitSpeechRecognition)) ||
  null;

export default function Home() {
  const [mode, setMode] = useState<"idle" | "recording" | "transcribing" | "editing" | "text">("idle");
  const [content, setContent] = useState("");
  const [transcriptBadge, setTranscriptBadge] = useState<TranscriptBadge>("real");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // ── Synchronous request lock ──────────────────────────────────────────────
  // React state updates are async — a second click can fire before re-render
  // sets `disabled`. The ref is read synchronously on every click event,
  // making any subsequent click a guaranteed no-op until the lock is released.
  const submittingRef = useRef(false);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const webSpeechRef = useRef<WebSpeechRecognition | null>(null);
  // Set to true when Web Speech produces a non-empty transcript — tells
  // MediaRecorder.onstop to skip Whisper.
  const webSpeechSucceeded = useRef(false);
  // Set to true when the user explicitly clicks Stop (vs Web Speech auto-stopping).
  const stoppedByUser = useRef(false);
  // Safety timer: stops MediaRecorder if recognition.onend never fires.
  const webSpeechSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic counter — incremented on each new recording so a late Whisper
  // response from a previous session cannot clobber the current UI.
  const recordingSession = useRef(0);
  const [, setLocation] = useLocation();
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();
  const { data: stats } = useGetEntryStats();
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if ((mode === "editing" || mode === "text") && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  // ── Recording ─────────────────────────────────────────────────────────────
  //
  // Approach — race-free Web Speech + Whisper coordination:
  //
  // MediaRecorder always runs so audio is captured. Web Speech runs in parallel
  // as a free/instant enhancement. Crucially, MediaRecorder is NEVER stopped
  // from handleStopRecording when Web Speech is active — only recognition.onend
  // can stop it, after the success/failure decision is made. This eliminates
  // the race where onstop fires before onend.
  //
  //  handleStopRecording (user clicks stop)
  //    ├── Web Speech active? → stop recognition only; set safety timer
  //    │     recognition.onend fires (guaranteed before MediaRecorder.onstop)
  //    │       ├── transcript OK → set webSpeechSucceeded, update UI, stop recorder
  //    │       │     recorder.onstop → sees flag → releases tracks, returns
  //    │       └── empty/error   → stop recorder
  //    │             recorder.onstop → runs Whisper, updates UI
  //    └── Web Speech NOT active → stop recorder directly
  //          recorder.onstop → runs Whisper (or unavailable)

  const stopMediaRecorder = (session: number) => {
    const rec = mediaRecorder.current;
    if (!rec) return;

    const mimeType = rec.mimeType || "audio/webm";

    rec.onstop = async () => {
      // Release mic tracks regardless of outcome
      rec.stream?.getTracks().forEach(t => t.stop());

      if (webSpeechSucceeded.current) return; // Web Speech already handled UI

      // Guard: discard if a newer recording started while Whisper was in-flight
      if (recordingSession.current !== session) return;

      if (audioChunks.current.length > 0) {
        const blob = new Blob(audioChunks.current, { type: mimeType });
        const result = await transcribeAudio(blob);

        if (recordingSession.current !== session) return; // stale — discard

        if (result.source === "whisper" && result.transcript) {
          setContent(result.transcript);
          setTranscriptBadge("real");
        } else {
          setContent("");
          setTranscriptBadge("unavailable");
        }
      } else {
        setContent("");
        setTranscriptBadge("unavailable");
      }
      setMode("editing");
    };

    if (rec.state === "recording") rec.stop();
  };

  const handleStartRecording = async () => {
    // Increment session so any in-flight Whisper from a previous recording is ignored
    const session = ++recordingSession.current;
    audioChunks.current = [];
    webSpeechRef.current = null;
    mediaRecorder.current = null;
    webSpeechSucceeded.current = false;
    stoppedByUser.current = false;
    if (webSpeechSafetyTimer.current) clearTimeout(webSpeechSafetyTimer.current);

    // ── Step 1: Get mic access (needed by both paths) ──────────────────────
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error("Mic access denied", err);
      setContent("");
      setTranscriptBadge("unavailable");
      setMode("editing");
      return;
    }

    // ── Step 2: MediaRecorder — always running, Whisper fallback ──────────
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.current.push(e.data);
    };
    // Note: onstop is assigned by stopMediaRecorder() just before stopping,
    // so it closes over the correct session ID.
    mediaRecorder.current = recorder;
    recorder.start();

    // ── Step 3: Web Speech API — optional parallel enhancement ────────────
    if (SpeechRecognitionAPI) {
      try {
        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = "en-US";

        const parts: string[] = [];
        let hadRuntimeError = false;

        recognition.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              parts.push(event.results[i][0].transcript);
            }
          }
        };

        recognition.onerror = (event) => {
          console.error("SpeechRecognition error:", event.error);
          hadRuntimeError = true;
          // Keep MediaRecorder running — Whisper can use the audio when user stops
        };

        recognition.onend = () => {
          webSpeechRef.current = null;
          if (webSpeechSafetyTimer.current) {
            clearTimeout(webSpeechSafetyTimer.current);
            webSpeechSafetyTimer.current = null;
          }

          if (!stoppedByUser.current) {
            // Web Speech auto-stopped (e.g. network blip) before user clicked Stop.
            // Leave MediaRecorder running; user will click Stop manually.
            return;
          }

          const transcript = parts.join(" ").trim();
          if (transcript && !hadRuntimeError) {
            // Web Speech succeeded — signal stopMediaRecorder's onstop to skip Whisper
            webSpeechSucceeded.current = true;
            setContent(transcript);
            setTranscriptBadge("real");
            setMode("editing");
          }
          // Stop MediaRecorder AFTER this decision is recorded in webSpeechSucceeded.
          // Its onstop sees the flag and skips Whisper if Web Speech succeeded.
          stopMediaRecorder(session);
        };

        // Wrap start() — can throw synchronously on some browsers
        recognition.start();
        webSpeechRef.current = recognition;
      } catch (err) {
        console.error("SpeechRecognition could not start:", err);
        // webSpeechRef.current stays null — stopRecording goes straight to MediaRecorder
      }
    }

    setMode("recording");
  };

  const handleStopRecording = () => {
    setMode("transcribing");
    stoppedByUser.current = true;

    if (webSpeechRef.current) {
      // Stop Web Speech. Its onend will stop MediaRecorder AFTER deciding success/failure.
      // This guarantees onend always runs before recorder.onstop — no race.
      webSpeechRef.current.stop();

      // Safety net: if recognition.onend never fires (buggy implementation),
      // stop MediaRecorder ourselves after 3 s so the UI doesn't hang.
      const session = recordingSession.current;
      webSpeechSafetyTimer.current = setTimeout(() => {
        webSpeechSafetyTimer.current = null;
        webSpeechRef.current = null;
        stopMediaRecorder(session);
      }, 3000);
    } else if (mediaRecorder.current) {
      // No Web Speech — go straight to Whisper
      stopMediaRecorder(recordingSession.current);
    } else {
      // Nothing was recording
      setContent("");
      setTranscriptBadge("unavailable");
      setMode("editing");
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    // ── Layer 1: synchronous ref lock (beats React's async re-render) ────────
    if (submittingRef.current) return;
    if (!content.trim()) return;

    submittingRef.current = true;  // SET BEFORE any await — this is the guard
    setIsSaving(true);
    setSaveError(false);

    // ── Step 1: persist ───────────────────────────────────────────────────────
    try {
      const entry = await createEntry.mutateAsync({
        data: {
          content,
          captureType: mode === "text" ? "text" : "voice",
        },
      });

      // ── Step 2: AI categorisation (non-blocking on failure) ─────────────────
      // /api/ai/categorize is the single categoriser for the whole app — the
      // same endpoint the split review uses, so Home and Inbox can't disagree
      // about a capture's category. It falls back to keyword heuristics
      // server-side when Claude is unavailable, so a failure here only costs
      // the suggestion; the capture itself is already saved above.
      try {
        const res = await fetch("/api/ai/categorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: [content] }),
        });
        if (res.ok) {
          const { categories } = await res.json() as { categories?: string[] };
          const suggested = categories?.[0];
          if (suggested) {
            await updateEntry.mutateAsync({
              id: entry.id,
              data: { suggestedCategory: suggested as never },
            });
          }
        }
      } catch (err) {
        console.error("categorize failed (non-fatal):", err);
      }

      queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() });
      logEvent("capture_created", {
        captureType: mode === "text" ? "text" : "voice",
      });

      toast({ title: "Saved to Inbox ✓" });
      setLocation("/inbox");
      // Component unmounts — ref + state reset naturally. Do NOT release the lock
      // here or a fast navigation back could re-enable the button mid-flight.
    } catch (err) {
      console.error("Save failed", err);
      setSaveError(true);
      setIsSaving(false);
      submittingRef.current = false;  // release lock so user can retry
    }
  };

  // Visual disabled state — driven by state (ref drives the handler guard)
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
          <div className="flex flex-col items-center gap-14 animate-in fade-in zoom-in duration-500">
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
            {/* Transcript badge */}
            {mode === "editing" && (
              <>
                {transcriptBadge === "real" && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-secondary/80 text-secondary-foreground rounded-full text-sm self-start">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span>Real transcript — edit before saving</span>
                  </div>
                )}
                {transcriptBadge === "unavailable" && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-sm self-start">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Transcription unavailable — please type your note</span>
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
              disabled={isSubmitting}
            />

            {/* Error state */}
            {saveError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-2xl px-4 py-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Couldn't save — please try again.</span>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="ghost"
                size="lg"
                className="flex-1 rounded-full h-14"
                onClick={() => {
                  setMode("idle");
                  setContent("");
                  setSaveError(false);
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>

              <Button
                size="lg"
                className="flex-1 rounded-full h-14 text-base shadow-md"
                onClick={handleSave}
                disabled={isSubmitting || !content.trim()}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Saving…
                  </>
                ) : saveError ? (
                  <>
                    <AlertCircle className="w-5 h-5 mr-2" />
                    Try again
                  </>
                ) : (
                  "Save to Inbox"
                )}
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
