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

export type TranscriptSource = "whisper" | "unavailable" | "error";

export interface TranscriptResult {
  transcript: string;
  source: TranscriptSource;
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
    if (!res.ok) return { transcript: "", source: "error" };

    const data = await res.json();
    return {
      transcript: data.transcript ?? "",
      source: (data.source as TranscriptSource) ?? "error",
    };
  } catch {
    return { transcript: "", source: "error" };
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
  /** null means no plausible person name found in that snippet */
  names: (string | null)[];
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
      const n = raw[i];
      return typeof n === "string" && n.length > 0 ? n : null;
    });
    return { names, source: data.source ?? "error" };
  } catch {
    return { names: texts.map(() => null), source: "error" };
  }
}
