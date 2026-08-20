import { useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, signUp, signInWithGoogle } from "@/lib/auth-client";
import { Link } from "wouter";

type Mode = "signin" | "signup";

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === "signup";
  const canSubmit = email.trim() && password && (!isSignUp || name.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;

    setBusy(true);
    setError(null);

    const result = isSignUp
      ? await signUp(name.trim(), email.trim(), password)
      : await signIn(email.trim(), password);

    if (result.ok) {
      onSignedIn();
    } else {
      setError(result.error ?? "Something went wrong.");
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    setError(null);
    const result = await signInWithGoogle();
    // On success the browser navigates away, so only failure lands here.
    if (!result.ok) {
      setError(result.error ?? "Google sign-in is unavailable.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col min-h-[100dvh] items-center justify-center px-5 py-12 bg-background">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">One for All</h1>
          <p className="text-muted-foreground text-sm">One place for every part of you.</p>
        </header>

        <div className="bg-card border border-border/50 rounded-3xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">
            {isSignUp ? "Create your space" : "Welcome back"}
          </h2>
          <p className="text-sm text-muted-foreground mb-5">
            {isSignUp
              ? "Your entries are private to your account."
              : "Sign in to reach your entries."}
          </p>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 mb-4 px-3 py-2.5 bg-destructive/10 text-destructive rounded-2xl text-sm"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {isSignUp && (
              <Input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                className="h-11 bg-background"
              />
            )}
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              className="h-11 bg-background"
            />
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              // Tells password managers whether to offer a saved password or
              // generate a new one.
              autoComplete={isSignUp ? "new-password" : "current-password"}
              className="h-11 bg-background"
            />

            <Button
              type="submit"
              className="rounded-full h-11 w-full mt-1"
              disabled={!canSubmit || busy}
            >
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isSignUp ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div className="flex items-center gap-3 my-4">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="rounded-full h-11 w-full"
            onClick={handleGoogle}
            disabled={busy}
          >
            {/* Inline mark: the CSP blocks remote images, and this avoids a request. */}
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
              <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51Z" />
            </svg>
            Continue with Google
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-5">
          Your entries are private to you. Read the{" "}
          <Link href="/privacy" className="underline hover:text-foreground">privacy policy</Link>{" "}
          and <Link href="/terms" className="underline hover:text-foreground">terms</Link>.
        </p>

        <p className="text-center text-sm text-muted-foreground mt-5">
          {isSignUp ? "Already have an account?" : "No account yet?"}{" "}
          <button
            type="button"
            className="text-foreground font-medium hover:underline"
            onClick={() => { setMode(isSignUp ? "signin" : "signup"); setError(null); }}
          >
            {isSignUp ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}
