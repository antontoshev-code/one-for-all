import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/logger";
import { aiQuota, MAX_AUDIO_BYTES, MAX_TEXT_CHARS } from "../lib/ai-guard";
import { db, eq, and, notDeleted, peopleTable, vocabularyTable } from "@workspace/db";
import { correctTranscript, PLACES_BG, TERMS } from "../lib/vocabulary";

// ── Types ─────────────────────────────────────────────────────────────────

type Category = "journal" | "task" | "idea" | "log";
const VALID_CATEGORIES: Category[] = ["journal", "task", "idea", "log"];

/**
 * Haiku rather than an Opus-tier model: every call here is short-form
 * classification or segmentation, which Haiku handles well at roughly a fifth
 * of the cost. Cost per capture is the deciding constraint while the app is
 * free to use.
 */
const CLAUDE_MODEL = "claude-haiku-4-5";

// ── Heuristic fallback (mirrors frontend heuristics.ts) ───────────────────

// Log = SPECIFICALLY body / health / physical tracking.
// General daily-life activities default to journal.
function heuristicCategory(text: string): Category {
  const t = text.toLowerCase();
  if (
    ["need to", "remind", "todo", "must", "should", "don't forget",
      "remember to", "have to", "call", "email", "schedule", "meet",
      "pick up", "buy", "check"].some(w => t.includes(w))
  ) return "task";
  if (
    ["idea", "what if", "concept", "maybe we could", "what about",
      "thinking about building", "could be interesting", "perhaps",
      "i want to", "i think i want"].some(w => t.includes(w))
  ) return "idea";
  if (
    ["workout", "worked out", "exercise", "exercised", "training",
      "ran ", "running", "jogged", "jogging", "sprinted", "cycling", "swam",
      "lifted", "gym", "pull-up", "push-up", "bench press", "squat", "deadlift", "reps",
      "slept", "sleep", "woke up", "fatigue",
      "ate ", "eating", "meal", "breakfast", "lunch", "dinner", "calories", "fasting",
      "weight ", "weighed", "bmi",
      "heart rate", "pulse", "blood pressure", "steps taken",
      "headache", "stomachache", "pain", "sore", "symptom", "sick", "fever", "nausea",
      "medication", "vitamins", "supplements",
    ].some(w => t.includes(w))
  ) return "log";
  return "journal";
}

// ── Multer (audio upload, memory storage) ────────────────────────────────
// memoryStorage, never disk: the recording exists only for the life of the
// request, is streamed to Whisper, and is then garbage collected. Nothing to
// clean up, and nothing left behind if the process dies mid-request.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES },
});

const router = Router();

// ── Heuristic sentence splitter (fallback when Claude is unavailable) ─────

function heuristicSplit(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
  return raw.length > 1 ? raw : [text.trim()];
}

// ── POST /ai/transcribe ───────────────────────────────────────────────────
// Accepts multipart/form-data with field "audio".
// Returns { transcript, corrections, source: 'whisper' | 'unavailable' | 'error' }.

/**
 * Build a vocabulary hint for Whisper from the names this user already keeps.
 *
 * Whisper accepts a short prompt that biases decoding toward the words in it.
 * Proper nouns are exactly what it gets wrong — a Bulgarian capture came back
 * with "Пълночално" for "Първоначално" and invented plausible-sounding names
 * for real ones — and the people someone writes about are both the highest-value
 * words to get right and the ones no general model can know.
 *
 * Sent to the same provider that is already receiving the audio, and drawn only
 * from the caller's own rows, so this discloses nothing new. The 700-character
 * cap keeps it inside Whisper's ~224-token prompt window; beyond that the tail
 * is ignored, so spending it on the most recently updated people is better than
 * letting it truncate arbitrarily.
 */
interface UserVocabulary {
  /** Words to bias toward and correct towards. */
  use: string[];
  /** Words the user put back after a correction, never to be corrected again. */
  keep: string[];
}

async function userVocabulary(userId: string): Promise<UserVocabulary> {
  try {
    const [people, learned] = await Promise.all([
      db
        .select({ name: peopleTable.name, aliases: peopleTable.aliases })
        .from(peopleTable)
        // Someone you deleted should not be whispered back into transcriptions.
        .where(and(eq(peopleTable.userId, userId), notDeleted(peopleTable))),
      db
        .select({ word: vocabularyTable.word, kind: vocabularyTable.kind })
        .from(vocabularyTable)
        .where(eq(vocabularyTable.userId, userId)),
    ]);

    // Full names are split so "Петя Иванова" repairs a lone "Пети" too.
    const fromPeople = people
      .flatMap(p => [p.name, ...(p.aliases ?? [])])
      .flatMap(w => [w, ...w.split(" ")]);

    const fromLearned = learned.filter(w => w.kind === "use").map(w => w.word);
    const keep = learned.filter(w => w.kind === "keep").map(w => w.word.toLowerCase());

    return {
      use: [...new Set([...fromPeople, ...fromLearned].map(w => w.trim()).filter(Boolean))],
      keep,
    };
  } catch (err) {
    logger.warn({ err }, "Could not load vocabulary — transcribing without it");
    return { use: [], keep: [] };
  }
}

function vocabularyHint(words: string[]): string | undefined {
  {
    if (words.length === 0) return undefined;

    let hint = "";
    for (const word of words) {
      const next = hint ? `${hint}, ${word}` : word;
      if (next.length > 700) break;
      hint = next;
    }

    // Phrased as prose rather than a bare list: Whisper conditions on the
    // prompt as if it were preceding speech, so a natural sentence biases
    // better than a comma-separated dump.
    return `Names and places that may be mentioned: ${hint}.`;
  }
}

router.post("/ai/transcribe", upload.single("audio"), aiQuota, async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      logger.warn("OPENAI_API_KEY not set — transcription unavailable");
      return res.json({ transcript: "", source: "unavailable", reason: "no-api-key" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const openai = new OpenAI({ apiKey });

    // Build a File object from the uploaded buffer so the SDK can send it
    const ext = req.file.mimetype?.includes("ogg") ? "ogg"
      : req.file.mimetype?.includes("mp4") ? "mp4"
      : req.file.mimetype?.includes("m4a") ? "m4a"
      : "webm";
    const audioFile = new File([new Uint8Array(req.file.buffer)], `recording.${ext}`, {
      type: req.file.mimetype || "audio/webm",
    });

    // verbose_json rather than text: it returns per-segment `no_speech_prob`,
    // which is the only reliable way to tell real speech from Whisper
    // hallucinating over silence. Given silence the model does not return an
    // empty string — it emits memorised training fragments (Korean news
    // sign-offs, "thanks for watching"), which in a diary is worse than
    // returning nothing at all.
    // The user's own people, plus the curated lists. Places and product names
    // are the other half of what a general model mangles in a Bulgarian
    // sentence — "Столична" and "Trello" are not words it expects there.
    const personal = await userVocabulary(req.userId);

    // A word the user put back is removed from the correction target list, so
    // the app cannot keep making a correction they have already rejected.
    const kept = new Set(personal.keep);
    const vocabulary = [...personal.use, ...PLACES_BG, ...TERMS]
      .filter(w => !kept.has(w.toLowerCase()));

    // The prompt gets the personal words only. It is capped at roughly 224
    // tokens, so spending it on a fixed list would crowd out the names that
    // actually change per user — and the correction pass below covers the rest.
    const prompt = vocabularyHint(personal.use);

    const result = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "verbose_json",
      temperature: 0,
      // No `language` is set on purpose. Captures mix Bulgarian and English
      // freely — "Trello", "Brighteye" inside a Bulgarian sentence — and
      // pinning the language makes Whisper force those into Cyrillic.
      ...(prompt ? { prompt } : {}),
    });

    const verbose = result as unknown as {
      text?: string;
      duration?: number;
      segments?: { no_speech_prob?: number; avg_logprob?: number }[];
    };

    const raw = (verbose.text ?? "").trim();

    // Whisper ignored the prompt often enough that this is not optional: a
    // capture naming Петя came back with "Пети" while her name was in it.
    // Here the answer is deterministic rather than a hint.
    const { text: transcript, corrections } = correctTranscript(raw, vocabulary);
    if (corrections.length > 0) {
      // Count only. The corrected words come from the user's captures, and the
      // privacy page says server logs never record what they wrote — logging
      // the words here would quietly make that untrue.
      logger.info({ count: corrections.length }, "Repaired words against known vocabulary");
    }
    const segments = verbose.segments ?? [];

    // Too short to contain a real thought — almost certainly a mis-tap.
    if ((verbose.duration ?? 0) < 0.6) {
      return res.json({ transcript: "", source: "no-speech" });
    }

    if (transcript && segments.length > 0) {
      // Whisper is confident about silence when no_speech_prob is high, and
      // hallucinated text additionally tends to score a poor avg_logprob.
      // Requiring both keeps genuine quiet speech from being discarded.
      const likelySilence = segments.every(
        s => (s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.4,
      );
      if (likelySilence) {
        // Length rather than content: if the silence heuristic ever misfires
        // this is real speech from someone's diary, and logs must not hold it.
        logger.info({ chars: transcript.length }, "Discarded probable hallucination over silence");
        return res.json({ transcript: "", source: "no-speech" });
      }
    }

    // Corrections are returned, not just applied. Rewriting words in someone's
    // diary without showing them is the part of this that was uncomfortable —
    // shown, each one is a suggestion they can reject in one tap.
    return res.json({
      transcript,
      corrections,
      source: transcript ? "whisper" : "no-speech",
    });
  } catch (err) {
    logger.error({ err }, "Whisper transcription failed");
    return res.json({ transcript: "", source: "error", reason: String(err) });
  }
});

// ── POST /ai/categorize ───────────────────────────────────────────────────
// Body: { texts: string[] }
// Returns { categories: Category[], source: 'claude' | 'heuristic' }.

router.post("/ai/categorize", aiQuota, async (req, res) => {
  const { texts } = req.body as { texts: string[] };

  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: "texts must be a non-empty array" });
  }

  if (texts.join('').length > MAX_TEXT_CHARS) {
    return res.status(413).json({
      error: "Too much text to process at once",
      detail: `Limit is ${MAX_TEXT_CHARS.toLocaleString()} characters across all items.`,
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    logger.warn("ANTHROPIC_API_KEY not set — using heuristic categorization");
    return res.json({ categories: texts.map(heuristicCategory), source: "heuristic" });
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      tools: [
        {
          name: "categorize_texts",
          description:
            "Categorize each text snippet into exactly one of the allowed categories",
          input_schema: {
            type: "object",
            properties: {
              categories: {
                type: "array",
                items: {
                  type: "string",
                  enum: VALID_CATEGORIES,
                },
                description:
                  "Category for each input text, in the same order. Must be the same length as the input.",
              },
            },
            required: ["categories"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "categorize_texts" },
      system: `You are a personal journaling assistant. Classify each snippet into exactly one category:
- journal: personal reflections, feelings, daily thoughts, observations, general activities, weather, social events, and anything not better captured below — this is the default for everyday narrative
- task: action items, reminders, things the user needs to do (call, buy, schedule, remember to, must, should)
- idea: creative thoughts, concepts, what-if proposals, something to build, explore, or try
- log: ONLY body / health / physical tracking — workouts, sleep, eating, physical symptoms, pain, medication, weight, heart rate; do NOT use log for general activities like "went to a store" or "spent time outside"`,
      messages: [
        {
          role: "user",
          content: `Classify each of these ${texts.length} text(s):\n${texts
            .map((t, i) => `${i + 1}. ${t}`)
            .join("\n")}`,
        },
      ],
    });

    const toolUse = response.content.find(b => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("No tool_use block in Claude response");
    }

    const raw = (toolUse.input as { categories?: string[] }).categories ?? [];
    const categories: Category[] = texts.map((t, i) =>
      VALID_CATEGORIES.includes(raw[i] as Category)
        ? (raw[i] as Category)
        : heuristicCategory(t)
    );

    return res.json({ categories, source: "claude" });
  } catch (err) {
    logger.error({ err }, "Claude categorization failed — falling back to heuristic");
    return res.json({ categories: texts.map(heuristicCategory), source: "heuristic" });
  }
});

// ── POST /ai/detect-names ─────────────────────────────────────────────────
// Body: { texts: string[] }
// Returns { names: string[][], source: 'claude' | 'unavailable' | 'error' }.

router.post("/ai/detect-names", aiQuota, async (req, res) => {
  const { texts } = req.body as { texts: string[] };

  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: "texts must be a non-empty array" });
  }

  if (texts.join('').length > MAX_TEXT_CHARS) {
    return res.status(413).json({
      error: "Too much text to process at once",
      detail: `Limit is ${MAX_TEXT_CHARS.toLocaleString()} characters across all items.`,
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.json({ names: texts.map(() => []), source: "unavailable" });
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      tools: [
        {
          name: "extract_names",
          description:
            "Identify person names mentioned in diary/journal text snippets",
          input_schema: {
            type: "object",
            properties: {
              names: {
                type: "array",
                items: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Every person named in this snippet, in the order they appear. Empty array if none.",
                },
                description:
                  "One array per input text, same order. Use an empty array when no person is named.",
              },
            },
            required: ["names"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "extract_names" },
      system: `Extract EVERY human person named in each diary/journal snippet.
Rules:
- Return all of them, not just the first. "Met Petya, then Kalia and Elena came" → ["Petya", "Kalia", "Elena"]. Missing a person means the user has to add them by hand.
- Only include a name that clearly refers to a real person being mentioned personally (e.g. "Called Sarah" → "Sarah", "Lunch with Dr. Chen" → "Dr. Chen")
- Entries are written in English, Bulgarian, or both in the same sentence. Bulgarian names are just as valid — Петя, Калия, Елена are people. Return each name exactly as it is written in the text; do not transliterate between alphabets.
- Exclude: verbs, common nouns, place names ("Столична община" is a place, not a person), organisations, brands and product names (Trello, Brighteye), pronouns, months, weekdays, and words capitalised only because they start a sentence.
- Do not repeat the same person twice within one snippet.
- Be conservative about what counts as a person, but exhaustive once it does — an empty array is better than a false positive, yet a real second name must never be dropped.`,
      messages: [
        {
          role: "user",
          content: texts.map((t, i) => `${i + 1}. ${t}`).join("\n"),
        },
      ],
    });

    const toolUse = response.content.find(b => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("No tool_use block in Claude response");
    }

    const raw = (toolUse.input as { names?: unknown }).names;
    const rawList = Array.isArray(raw) ? raw : [];

    // Tolerate the older single-string shape as well as the array one: the
    // model occasionally answers with a bare string, and one malformed row
    // should cost that row's names, not the whole capture's.
    const names = texts.map((_, i) => {
      const entry = rawList[i];
      const list = Array.isArray(entry) ? entry : typeof entry === "string" ? [entry] : [];
      const cleaned = list
        .filter((n): n is string => typeof n === "string")
        .map(n => n.trim())
        .filter(n => n.length > 0);
      return [...new Map(cleaned.map(n => [n.toLowerCase(), n])).values()];
    });

    return res.json({ names, source: "claude" });
  } catch (err) {
    logger.error({ err }, "Claude name detection failed");
    return res.json({ names: texts.map(() => []), source: "error" });
  }
});

// ── POST /ai/split ────────────────────────────────────────────────────────
// Segments a personal capture into semantic thought units using Claude.
// Body: { text: string }
// Returns: { units: Array<{ text, category, people: string[] }>, source: 'claude'|'heuristic' }
// Falls back to punctuation splitting + heuristic categorization if Claude is unavailable.

router.post("/ai/split", aiQuota, async (req, res) => {
  const { text } = req.body as { text?: string };

  if (!text?.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  if (text.length > MAX_TEXT_CHARS) {
    return res.status(413).json({
      error: "Capture is too long to organise",
      detail: `Limit is ${MAX_TEXT_CHARS.toLocaleString()} characters. The capture is saved — it just won't be split automatically.`,
    });
  }

  const clean = text.trim();

  const fallback = () =>
    heuristicSplit(clean).map(chunk => ({
      text: chunk,
      category: heuristicCategory(chunk),
      people: [] as string[],
    }));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({ units: fallback(), source: "heuristic" });
  }

  try {
    const anthropic = new Anthropic({ apiKey });

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      tools: [
        {
          name: "return_thought_units",
          description: "Return the thought units segmented from the personal capture.",
          input_schema: {
            type: "object" as const,
            properties: {
              units: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: {
                      type: "string",
                      description:
                        "The text of this thought unit. Lightly clean spoken filler (\"you know\", \"hmm\", \"okay so\") and add sentence-ending punctuation if missing — but NEVER invent, summarise, or drop any substantive meaning.",
                    },
                    category: {
                      type: "string",
                      enum: ["journal", "task", "idea", "log"],
                    },
                    people: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Person names genuinely mentioned in this unit, exactly as they appear in the text.",
                    },
                  },
                  required: ["text", "category", "people"],
                },
              },
            },
            required: ["units"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "return_thought_units" },
      system: `You are processing a personal diary / journal capture. Segment it by TRAIN OF THOUGHT — NOT by sentence.

Rules for segmentation:
- Consecutive statements elaborating the SAME subject stay together as ONE unit.
- A genuine TOPIC CHANGE starts a new unit.
- Spoken filler ("you know", "hmm", "okay so", "like", "I mean") and false starts are NOT topic changes — remove them from the output text.
- Add sentence-ending punctuation where naturally missing, but NEVER invent, summarise, or drop any of the user's substantive meaning. Every substantive part of the original must appear in exactly one unit.
- A capture may legitimately be a SINGLE thought — in that case return exactly one unit.

Category definitions (assign exactly one per unit):
- journal: thoughts, feelings, reflections, things that happened, general observations
- task: something the user needs to do or follow up on (signals: "tomorrow", "need to", "should", "want to" + a concrete action planned)
- idea: a concept, plan, or possibility the user is exploring or thinking about building/creating
- log: body, health, workouts, sleep, food, physical sensations ONLY — NOT general daily narration

People: extract person names genuinely mentioned in each unit. Return them exactly as they appear in the text.`,
      messages: [{ role: "user", content: clean }],
    });

    const toolUse = response.content.find(b => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return res.json({ units: fallback(), source: "heuristic" });
    }

    const input = toolUse.input as {
      units: { text: string; category: string; people: string[] }[];
    };

    if (!Array.isArray(input?.units) || input.units.length === 0) {
      return res.json({ units: fallback(), source: "heuristic" });
    }

    const units = input.units
      .filter(u => u.text?.trim())
      .map(u => ({
        text: u.text.trim(),
        category: (VALID_CATEGORIES.includes(u.category as Category)
          ? u.category
          : heuristicCategory(u.text)) as Category,
        people: Array.isArray(u.people)
          ? u.people.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          : [],
      }));

    if (units.length === 0) {
      return res.json({ units: fallback(), source: "heuristic" });
    }

    return res.json({ units, source: "claude" });
  } catch (err) {
    logger.error({ err }, "Claude split failed — falling back to heuristic");
    return res.json({ units: fallback(), source: "heuristic" });
  }
});

// ── GET /ai/status ────────────────────────────────────────────────────────
// Returns which AI providers are configured (without revealing keys).

router.get("/ai/status", (_req, res) => {
  res.json({
    transcription: {
      provider: "openai-whisper",
      active: !!process.env.OPENAI_API_KEY,
    },
    categorization: {
      provider: "claude",
      active: !!process.env.ANTHROPIC_API_KEY,
    },
  });
});

export default router;
