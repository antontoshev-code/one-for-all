import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { signOut, getSession, type AuthUser } from "@/lib/auth-client";
import {
  Trash2, AlertTriangle, Info, Loader2, Download,
  Shield, Mic, Sparkles, CheckCircle2, XCircle,
  Palette, Sun, Moon, Monitor, LogOut, UserX, BookOpen, Gauge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logEvent } from "@/lib/analytics";
import { Link } from "wouter";

// ── AI Status ─────────────────────────────────────────────────────────────

interface AIStatus {
  transcription: { provider: string; active: boolean };
  categorization: { provider: string; active: boolean };
}

function StatusRow({
  label, active, activeText, inactiveText,
}: {
  label: string; active: boolean; activeText: string; inactiveText: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {active
        ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        : <XCircle className="w-4 h-4 text-muted-foreground/60 shrink-0 mt-0.5" />}
      <span>
        <span className="font-medium text-foreground">{label}: </span>
        <span className={active ? "text-emerald-700" : "text-muted-foreground"}>
          {active ? activeText : inactiveText}
        </span>
      </span>
    </div>
  );
}

// ── Appearance ────────────────────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  // next-themes can't know the resolved theme until after mount; render the
  // control in a neutral state until then so no option flashes as selected.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <section className="bg-card border border-border/50 rounded-3xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Palette className="w-5 h-5 text-primary shrink-0" />
        <h2 className="text-base font-semibold">Appearance</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
        Choose how One for All looks. <strong className="text-foreground">System</strong> follows
        your device setting and switches automatically.
      </p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Colour theme">
        {THEME_OPTIONS.map(({ value, label, Icon }) => {
          const selected = mounted && theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTheme(value);
                logEvent("theme_changed");
              }}
              aria-pressed={selected}
              className={[
                "flex flex-col items-center justify-center gap-1.5 rounded-2xl px-3 py-4",
                "text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80",
              ].join(" ")}
            >
              <Icon className="w-5 h-5" />
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Daily allowance ───────────────────────────────────────────────────────

interface Usage {
  requests: { used: number; limit: number };
  voiceMinutes: { used: number; limit: number };
  resetsInHours: number;
}

/**
 * Today's AI allowance, shown before it runs out.
 *
 * The limit was invisible until it stopped you, and then it arrived as a
 * refusal that read like a fault. Seeing "6 of 40" costs nothing and turns a
 * confusing failure into an expected one — and the message it replaces was the
 * only place the app ever mentioned a limit at all.
 */
function AllowanceSection() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/ai/usage")
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setUsage)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;

  const bar = (used: number, limit: number) => {
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    return (
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  };

  return (
    <section className="bg-card border border-border/50 rounded-3xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="w-5 h-5 text-primary shrink-0" />
        <h2 className="text-base font-semibold">Your usage</h2>
      </div>

      {usage === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-baseline justify-between mb-1.5 text-sm">
              <span className="text-muted-foreground">Captures organised by AI</span>
              <span className="font-medium">
                {usage.requests.used} of {usage.requests.limit}
              </span>
            </div>
            {bar(usage.requests.used, usage.requests.limit)}
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1.5 text-sm">
              <span className="text-muted-foreground">Voice minutes transcribed</span>
              <span className="font-medium">
                {usage.voiceMinutes.used} of {usage.voiceMinutes.limit} min
              </span>
            </div>
            {bar(usage.voiceMinutes.used, usage.voiceMinutes.limit)}
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Resets in about {usage.resetsInHours} hour{usage.resetsInHours === 1 ? "" : "s"},
            at midnight UTC.
          </p>
          {/* The two limits are separate and fail differently, so they say so
              separately. "AI limit reached" leaves someone guessing which one,
              and whether their recording survived. */}
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Reaching a limit never costs you a capture.</strong>{" "}
            If transcription runs out, the recording is still saved and you can type
            the words yourself. If organising runs out, the text is saved and you can
            file it by hand. Everything stays editable and exportable either way.
          </p>
        </div>
      )}
    </section>
  );
}

// ── Vocabulary ────────────────────────────────────────────────────────────

interface VocabWord {
  id: number;
  word: string;
  kind: "use" | "keep";
  source: "learned" | "manual";
}

/**
 * The words this account has taught the app, and a way to take them back.
 *
 * Learning from corrections is only safe if it can be undone. A word picked up
 * from a typo would otherwise quietly bend every future transcription towards
 * it, with nothing to look at and no way to say no.
 */
function VocabularySection() {
  const [words, setWords] = useState<VocabWord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const load = () => {
    fetch("/api/vocabulary")
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setWords)
      .catch(() => setFailed(true));
  };

  useEffect(load, []);

  const remove = async (id: number) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/vocabulary/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setWords(prev => prev?.filter(w => w.id !== id) ?? null);
    } catch (err) {
      console.error("Failed to remove the word", err);
    } finally {
      setBusyId(null);
    }
  };

  const add = async () => {
    const word = draft.trim();
    if (!word) return;
    setIsAdding(true);
    try {
      const res = await fetch("/api/vocabulary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDraft("");
      load();
    } catch (err) {
      console.error("Failed to add the word", err);
    } finally {
      setIsAdding(false);
    }
  };

  const used = words?.filter(w => w.kind === "use") ?? [];
  const kept = words?.filter(w => w.kind === "keep") ?? [];

  return (
    <section className="bg-card border border-border/50 rounded-3xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen className="w-5 h-5 text-primary shrink-0" />
        <h2 className="text-base font-semibold">Words the app has learned</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
        When you fix a word in a transcript, it is remembered so future recordings
        get it right. These stay on your account and are never shared.
      </p>

      {failed ? (
        <p className="text-sm text-muted-foreground">Could not load your words.</p>
      ) : words === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {used.length === 0 && kept.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing yet. Correct a word in a transcript before saving and it will
              appear here.
            </p>
          )}

          {used.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Spellings it will use
              </p>
              <div className="flex flex-wrap gap-2">
                {used.map(w => (
                  <span
                    key={w.id}
                    className="inline-flex items-center gap-1.5 bg-secondary rounded-full pl-3 pr-1.5 py-1 text-sm"
                  >
                    {w.word}
                    <button
                      onClick={() => remove(w.id)}
                      disabled={busyId === w.id}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                      aria-label={`Forget ${w.word}`}
                    >
                      {busyId === w.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <XCircle className="w-3.5 h-3.5" />}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {kept.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Words it will never change
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                Added when you undo a suggested correction.
              </p>
              <div className="flex flex-wrap gap-2">
                {kept.map(w => (
                  <span
                    key={w.id}
                    className="inline-flex items-center gap-1.5 bg-secondary/60 rounded-full pl-3 pr-1.5 py-1 text-sm text-muted-foreground"
                  >
                    {w.word}
                    <button
                      onClick={() => remove(w.id)}
                      disabled={busyId === w.id}
                      className="hover:text-destructive disabled:opacity-50"
                      aria-label={`Stop protecting ${w.word}`}
                    >
                      {busyId === w.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <XCircle className="w-3.5 h-3.5" />}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") add(); }}
              placeholder="Add a word it keeps getting wrong…"
              className="h-9 text-sm bg-background"
            />
            <Button
              variant="outline"
              className="rounded-full h-9 shrink-0"
              disabled={isAdding || !draft.trim()}
              onClick={add}
            >
              {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Delete account ────────────────────────────────────────────────────────

/**
 * Erasing the account, as distinct from emptying it.
 *
 * Gated behind typing the account's own email rather than a generic "are you
 * sure". Every other destructive control here is recoverable from an export;
 * this one takes the account with it, so the confirmation is deliberately
 * something you cannot do by reflex.
 */
function DeleteAccountSection() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => { void getSession().then(setUser); }, []);

  // Case-insensitive: the address is a confirmation, not a password, and
  // failing someone for capitalising their own email would just be rude.
  const confirmed = Boolean(user?.email) &&
    typed.trim().toLowerCase() === user!.email.toLowerCase();

  const handleDelete = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/data/account", { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      logEvent("account_deleted");
      // Straight out of the app: the session is gone, so every subsequent
      // request would 401 and the UI would look broken rather than finished.
      window.location.href = "/";
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <section className="bg-destructive/5 border border-destructive/20 rounded-3xl p-5">
      <h2 className="text-base font-semibold text-destructive flex items-center gap-2 mb-2">
        <UserX className="w-5 h-5 shrink-0" /> Delete my account
      </h2>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
        Closes the account itself and erases everything in it — entries, people,
        recordings and your sign-in. Nothing is kept, and it cannot be restored
        afterwards. Export first if you want a copy.
      </p>

      {error && (
        <p className="text-sm text-destructive mb-3">Something went wrong. Please try again.</p>
      )}

      {!armed ? (
        <Button variant="destructive" className="rounded-full w-full" onClick={() => setArmed(true)}>
          <UserX className="w-4 h-4 mr-2" />
          Delete my account
        </Button>
      ) : (
        <div className="flex flex-col gap-3 animate-in fade-in">
          <label className="text-sm text-destructive leading-relaxed">
            Type <strong>{user?.email ?? "your email"}</strong> to confirm.
          </label>
          <Input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={user?.email ?? "your email"}
            autoComplete="off"
            className="h-11 bg-background"
          />
          <Button
            variant="destructive"
            className="rounded-full w-full"
            onClick={handleDelete}
            disabled={!confirmed || busy}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Permanently delete my account
          </Button>
          <Button
            variant="outline"
            className="rounded-full w-full"
            onClick={() => { setArmed(false); setTyped(""); }}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function Settings() {
  const queryClient = useQueryClient();

  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [aiStatusError, setAiStatusError] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  const [isClearing, setIsClearing] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [clearError, setClearError] = useState(false);

  // Fetch AI status once on mount
  useEffect(() => {
    fetch("/api/ai/status")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setAiStatus)
      .catch(() => setAiStatusError(true));
  }, []);

  // ── Export ───────────────────────────────────────────────────────────────

  const handleExport = async () => {
    setIsExporting(true);
    setExportError(false);
    logEvent("export_requested");
    try {
      const res = await fetch("/api/data/export");
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `one-for-all-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setIsExporting(false);
    }
  };

  // ── Clear all ─────────────────────────────────────────────────────────────

  const handleClearData = async () => {
    setIsClearing(true);
    setClearError(false);
    try {
      const res = await fetch("/api/data/clear", { method: "POST" });
      if (!res.ok) throw new Error("Clear failed");
      logEvent("data_cleared");
      queryClient.clear();
      window.location.href = "/";
    } catch {
      setClearError(true);
      setIsClearing(false);
      setConfirmStep(false);
    }
  };

  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-4 pt-12 max-w-2xl mx-auto w-full">
      <header className="mb-8 px-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      </header>

      <div className="flex flex-col gap-5">

        {/* ── Appearance ──────────────────────────────────────────────────── */}
        <AppearanceSection />

        {/* ── AI Processing Status ────────────────────────────────────────── */}
        <section className="bg-card border border-border/50 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-primary shrink-0" />
            <h2 className="text-base font-semibold">AI Processing</h2>
          </div>

          {aiStatusError ? (
            <p className="text-sm text-muted-foreground">Could not load AI status.</p>
          ) : aiStatus === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking…
            </div>
          ) : (
            <div className="space-y-2.5">
              <StatusRow
                label="Voice transcription"
                active={aiStatus.transcription.active}
                activeText="OpenAI Whisper — real transcription active"
                inactiveText="Using placeholder text — set OPENAI_API_KEY in Secrets to enable"
              />
              <StatusRow
                label="Categorization"
                active={aiStatus.categorization.active}
                activeText="Anthropic Claude — real AI categorization active"
                inactiveText="Using keyword heuristics — set ANTHROPIC_API_KEY in Secrets to enable"
              />
              {!aiStatus.transcription.active && !aiStatus.categorization.active && (
                <p className="text-xs text-muted-foreground pt-1 pl-6">
                  The app works fully without API keys — AI features are optional enhancements.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ── Audio Retention ─────────────────────────────────────────────── */}
        <section className="bg-card border border-border/50 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Mic className="w-5 h-5 text-primary shrink-0" />
            <h2 className="text-base font-semibold">Voice Recordings</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            When you record audio, it is sent to OpenAI Whisper for transcription and then
            immediately discarded.{" "}
            <strong className="text-foreground">No audio is stored on this server</strong> — only
            the resulting text is saved.
          </p>
        </section>

        {/* ── Daily allowance ─────────────────────────────────────────────── */}
        <AllowanceSection />

        {/* ── Learned vocabulary ──────────────────────────────────────────── */}
        <VocabularySection />

        {/* ── Privacy Notice ───────────────────────────────────────────────── */}
        <section className="bg-card border border-border/50 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5 text-primary shrink-0" />
            <h2 className="text-base font-semibold">Privacy</h2>
          </div>
          <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
            <p>
              <strong className="text-foreground">What's stored:</strong>{" "}
              Your text entries and optional notes about people you mention. Nothing else is collected.
            </p>
            <p>
              <strong className="text-foreground">People profiles:</strong>{" "}
              Created only by you, manually. The app never silently creates profiles or identifies 
              people without your explicit confirmation.
            </p>
            <p>
              <strong className="text-foreground">AI processing:</strong>{" "}
              When AI features are configured, entry text is sent to OpenAI or Anthropic for 
              processing. When not configured, everything stays local. See the AI status above.
            </p>
            <p>
              <strong className="text-foreground">Your control:</strong>{" "}
              You can export all your data or delete everything below, at any time.
            </p>
            <p className="pt-1">
              <Link href="/privacy" className="text-primary font-medium hover:underline">
                Read the full privacy policy
              </Link>
              <span className="mx-2 text-muted-foreground">·</span>
              <Link href="/terms" className="text-primary font-medium hover:underline">
                Terms
              </Link>
            </p>
          </div>
        </section>

        {/* ── Data Export ──────────────────────────────────────────────────── */}
        <section className="bg-card border border-border/50 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-5 h-5 text-primary shrink-0" />
            <h2 className="text-base font-semibold">Export My Data</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            Downloads a complete JSON file containing all your entries, people, and their links. 
            Nothing is redacted or summarised — you get everything.
          </p>
          {exportError && (
            <p className="text-sm text-destructive mb-3">Export failed — please try again.</p>
          )}
          <Button
            variant="outline"
            className="rounded-full w-full"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <Download className="w-4 h-4 mr-2" />}
            {isExporting ? "Preparing download…" : "Download export"}
          </Button>
        </section>

        {/* ── Danger Zone ──────────────────────────────────────────────────── */}
        <section className="bg-destructive/5 border border-destructive/20 rounded-3xl p-5 mb-4">
          <h2 className="text-base font-semibold text-destructive flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 shrink-0" /> Danger Zone
          </h2>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            Permanently deletes every entry, every person profile, and all associated data. 
            This cannot be undone. Export first if you want to keep a copy.
          </p>

          {clearError && (
            <p className="text-sm text-destructive mb-3">Something went wrong. Please try again.</p>
          )}

          {!confirmStep ? (
            <Button
              variant="destructive"
              className="rounded-full w-full"
              onClick={() => setConfirmStep(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear all my data
            </Button>
          ) : (
            <div className="flex flex-col gap-3 animate-in fade-in">
              <div className="bg-destructive/10 rounded-2xl p-3 text-sm text-destructive leading-relaxed">
                <strong>This will permanently delete:</strong> all entries, all people profiles, and 
                all linked data. There is no undo — export your data first if you want a copy.
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  variant="destructive"
                  className="rounded-full w-full"
                  onClick={handleClearData}
                  disabled={isClearing}
                >
                  {isClearing && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Yes, permanently delete everything
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full w-full"
                  onClick={() => setConfirmStep(false)}
                  disabled={isClearing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ── Delete account ──────────────────────────────────────────────── */}
        <DeleteAccountSection />

        {/* ── Account ─────────────────────────────────────────────────────── */}
        <section className="bg-card border border-border/50 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <LogOut className="w-5 h-5 text-primary shrink-0" />
            <h2 className="text-base font-semibold">Account</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            Your entries are private to your account. Signing out leaves them
            untouched — they're waiting when you sign back in.
          </p>
          <Button
            variant="outline"
            className="rounded-full w-full"
            onClick={async () => {
              await signOut();
              // Full reload rather than a state reset: it clears React Query's
              // cache too, so no fragment of the previous session's data can
              // survive into the next one.
              window.location.href = "/";
            }}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </section>

      </div>
    </div>
  );
}
