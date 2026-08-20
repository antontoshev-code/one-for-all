/**
 * Thin wrappers around the /api/ai/* backend endpoints.
 * All functions fall back gracefully and never throw.
 */

export type Category = "journal" | "task" | "idea" | "log";

const VALID: Category[] = ["journal", "task", "idea", "log"];

function isCategory(v: unknown): v is Category {
  return VALID.includes(v as Category);
}

// ── Transcription ──────────────────────────────────────────────────────────

/**
 * 'no-speech' means the recording contained no speech the server was willing
 * to trust. It is distinct from 'unavailable'/'error': transcription worked,
 * there was simply nothing to hear. Whisper invents plausible-sounding text
 * when given silence, so the server discards those rather than passing them on.
 */
export type TranscriptSource = "whisper" | "no-speech" | "unavailable" | "error";

export interface TranscriptResult {
  transcript: string;
  source: TranscriptSource;
  /**
   * Words repaired against the vocabulary, so the user can see and reject them.
   * Applying a correction without showing it would be editing their words.
   */
  corrections: { from: string; to: string }[];
}

/**
 * Upload a recorded audio blob to the backend and get back a real transcript.
 * On failure returns { transcript: '', source: 'error' } — never throws.
 */
export async function transcribeAudio(blob: Blob): Promise<TranscriptResult> {
  try {
    const ext = blob.type.includes("ogg") ? "ogg"
      : blob.type.includes("mp4") ? "mp4"
      : blob.type.includes("m4a") ? "m4a"
      : "webm";

    const formData = new FormData();
    formData.append("audio", blob, `recording.${ext}`);

    const res = await fetch("/api/ai/transcribe", { method: "POST", body: formData });
    if (!res.ok) return { transcript: "", source: "error", corrections: [] };

    const data = await res.json();
    return {
      transcript: data.transcript ?? "",
      source: (data.source as TranscriptSource) ?? "error",
      corrections: Array.isArray(data.corrections) ? data.corrections : [],
    };
  } catch {
    return { transcript: "", source: "error", corrections: [] };
  }
}

// ── Categorization ─────────────────────────────────────────────────────────

export interface CategorizeResult {
  categories: Category[];
  /** 'claude' when real AI was used; 'heuristic' when API key missing; 'error' on failure */
  source: "claude" | "heuristic" | "error";
}

/**
 * Classify one or more text snippets via the backend Claude endpoint.
 * On failure falls back to heuristic results from the server — never throws.
 */
export async function categorizeTexts(texts: string[]): Promise<CategorizeResult> {
  try {
    const res = await fetch("/api/ai/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const raw: unknown[] = Array.isArray(data.categories) ? data.categories : [];
    const categories: Category[] = texts.map((_, i) =>
      isCategory(raw[i]) ? (raw[i] as Category) : "journal"
    );
    return { categories, source: data.source ?? "heuristic" };
  } catch {
    // Complete failure — return journal as safe default for every text
    return { categories: texts.map(() => "journal" as Category), source: "error" };
  }
}

// ── Name detection ─────────────────────────────────────────────────────────

export interface NamesResult {
  /** One array per snippet — every person named in it, empty when none. */
  names: string[][];
  source: "claude" | "unavailable" | "error";
}

/**
 * Ask Claude to identify person names in each text snippet.
 * On failure returns all-null names — never throws.
 */
export async function detectPersonNames(texts: string[]): Promise<NamesResult> {
  try {
    const res = await fetch("/api/ai/detect-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const raw: unknown[] = Array.isArray(data.names) ? data.names : [];
    const names = texts.map((_, i) => {
      const entry = raw[i];
      const list = Array.isArray(entry) ? entry : typeof entry === "string" ? [entry] : [];
      return list.filter((n): n is string => typeof n === "string" && n.length > 0);
    });
    return { names, source: data.source ?? "error" };
  } catch {
    return { names: texts.map(() => []), source: "error" };
  }
}
