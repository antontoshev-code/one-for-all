import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { signOut, getSession, type AuthUser } from "@/lib/auth-client";
import {
  Trash2, AlertTriangle, Info, Loader2, Download,
  Shield, Mic, Sparkles, CheckCircle2, XCircle,
  Palette, Sun, Moon, Monitor, LogOut, UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logEvent } from "@/lib/analytics";

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
            When you record audio, it is sent to OpenAI Whisper for transcription (if configured) 
            and then immediately discarded.{" "}
            <strong className="text-foreground">No audio is stored on this server</strong> — only 
            the resulting text is saved. If real transcription is not configured, the audio never 
            leaves your device and a placeholder transcript is used instead.
          </p>
        </section>

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

      </div>
    </div>
  );
}
