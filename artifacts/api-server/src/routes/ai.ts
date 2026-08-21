import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/logger";
import { aiQuota, MAX_AUDIO_BYTES, MAX_TEXT_CHARS } from "../lib/ai-guard";
import { db, eq, and, notDeleted, peopleTable, vocabularyTable } from "@workspace/db";
import {
  correctTranscript, stripLeadingFiller,
  PLACES_BG, TERMS, ADDRESS_BG, ADDRESS_EN, LOANWORDS_BG, BRANDS,
} from "../lib/vocabulary";

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
//
// Kept deliberately in step with the frontend's version: this runs when Claude
// is unavailable, and the two disagreeing about what a capture is would be
// worse than either being wrong on its own. Both languages the app supports are
// covered — an English-only keyword list filed every Bulgarian capture as a
// journal entry.

const TASK_WORDS = [
  "need to", "remind", "todo", "must", "should", "don't forget",
  "remember to", "have to", "call", "email", "schedule", "pick up", "buy", "check",
  "трябва", "имам задача", "задача да", "не забравя", "напомни", "напомняне",
  "ще трябва", "предстои", "остава да", "да звънна", "да се обадя", "да купя",
  "да взема", "да напиша", "да изпратя", "да проверя", "да подготвя", "за утре",
];

const IDEA_WORDS = [
  "idea", "what if", "concept", "maybe we could", "what about",
  "thinking about building", "could be interesting", "perhaps",
  "i want to", "i think i want",
  "идея", "хрумна ми", "какво ако", "би било", "мисля да направя",
  "искам да направя", "би било интересно", "какво ще стане ако",
];

const LOG_WORDS = [
  "workout", "worked out", "exercise", "exercised", "training",
  "ran ", "running", "jogged", "jogging", "sprinted", "cycling", "swam",
  "lifted", "gym", "pull-up", "push-up", "bench press", "squat", "deadlift", "reps",
  "slept", "sleep", "woke up", "fatigue", "felt great", "felt tired", "energy",
  "ate ", "eating", "meal", "breakfast", "lunch", "dinner", "calories", "fasting",
  "weight ", "weighed", "bmi", "heart rate", "pulse", "blood pressure", "steps taken",
  "headache", "stomachache", "pain", "sore", "symptom", "sick", "fever", "nausea",
  "medication", "vitamins", "supplements",
  // Strength-training vocabulary. "I did my standard calisthenics protocol and
  // 45 kg bench press 3 sets" had one hit in thirteen words and read as
  // narrative, so a plainly physical note was filed as a diary entry and then
  // offered for splitting away from its own first sentence.
  "calisthenics", "sets", "set of", "kg", "bodyweight", "cardio", "stretching",
  "plank", "burpees", "lunges", "curls", "press", "rows", "dips", "chin-up",
  "warm up", "warmed up", "cool down", "protocol", "circuit", "interval",
  "тренирах", "тренировка", "тренирам", "фитнес", "бягах", "бягане", "плувах",
  "лицеви", "коремни", "клекове", "набирания", "щанга", "серии", "повторения",
  "кардио", "спах", "не спах", "събудих се", "умора", "изтощен", "енергия",
  "закуска", "обяд", "вечеря", "хранене", "калории", "тегло", "главоболие",
  "болка", "боли ме", "температура", "болен", "лекарство", "витамини", "пулс",
];

function heuristicCategory(text: string): Category {
  const t = text.toLowerCase();
  if (TASK_WORDS.some(w => t.includes(w))) return "task";
  if (IDEA_WORDS.some(w => t.includes(w))) return "idea";

  // Log needs the sentence to be ABOUT the body rather than to mention it in
  // passing: "Слязох до София с колата и там тренирах" is narrative.
  const hits = LOG_WORDS.filter(w => t.includes(w)).length;
  const words = t.split(/\s+/).filter(Boolean).length;
  if (hits >= 2 || (hits === 1 && words <= 6)) return "log";

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

/**
 * Sentences grouped into units, splitting only where the category changes.
 *
 * Plain sentence splitting turned one evening's diary into eight pieces. A
 * day's account is one entry however many things happened in it; the reason to
 * separate a part is that it belongs somewhere else.
 */
function heuristicSplit(text: string): { text: string; category: Category }[] {
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
  if (sentences.length <= 1) {
    return [{ text: text.trim(), category: heuristicCategory(text) }];
  }

  const units: { text: string; category: Category }[] = [];
  for (const sentence of sentences) {
    const category = heuristicCategory(sentence);
    const last = units[units.length - 1];
    if (last && last.category === category) {
      last.text = `${last.text} ${sentence}`.trim();
    } else {
      units.push({ text: sentence, category });
    }
  }
  return units;
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
    const vocabulary = [
      ...personal.use, ...PLACES_BG, ...TERMS,
      ...ADDRESS_BG, ...ADDRESS_EN, ...LOANWORDS_BG, ...BRANDS,
    ].filter(w => !kept.has(w.toLowerCase()));

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
    // Filler first, so a correction is never applied to a word that is about
    // to be removed and then reported as a change the user never saw.
    const { text: transcript, corrections } = correctTranscript(stripLeadingFiller(raw), vocabulary);
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
- task: something NOT YET DONE that the user needs to do (call, buy, schedule, remember to, must, should)
- idea: creative thoughts, concepts, what-if proposals, something to build, explore, or try
- log: ONLY body / health / physical tracking — workouts, sleep, eating, physical symptoms, pain, medication, weight, heart rate; do NOT use log for general activities like "went to a store" or "spent time outside"

TENSE IS DECISIVE between journal and task. A task has not happened yet. "I sorted out the support ticket and opened a case" is journal — it is done, the user is recounting it. "I need to prepare the tea before we leave" is a task — it is still ahead of them. Past tense is never a task however action-like the verbs are; a completed action recounted is the diary.`,
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
  const { text, now, timeZone } = req.body as {
    text?: string;
    /** The client's clock. "tonight at 21:20" is meaningless without it. */
    now?: string;
    timeZone?: string;
  };

  // Trusted only as far as being a real timestamp: it decides what "tonight"
  // means, so a malformed value falls back to no context rather than reaching
  // the model as nonsense.
  const nowIso = now && !Number.isNaN(Date.parse(now)) ? new Date(now).toISOString() : null;
  const zone = typeof timeZone === "string" && /^[\w+\-/]{1,64}$/.test(timeZone) ? timeZone : null;

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
    heuristicSplit(clean).map(unit => ({
      text: unit.text,
      category: unit.category,
      people: [] as string[],
      // Without a model there is nothing to read a date out of a sentence with.
      dueAt: null as string | null,
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
                        "The text of this thought unit, IN THE SAME LANGUAGE THE USER SPOKE. Never translate. Lightly clean spoken filler (\"you know\", \"hmm\", \"okay so\") and add sentence-ending punctuation if missing — but NEVER invent, summarise, or drop any substantive meaning.",
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
                    dueAt: {
                      type: ["string", "null"],
                      description:
                        "For a task with a stated time, when it is due, as an ISO 8601 timestamp with the offset (e.g. 2026-08-20T21:20:00+03:00). Null for anything without a time — most tasks have none, and a made-up deadline is worse than no deadline.",
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
      system: `You are processing a personal diary capture. Decide whether it needs splitting at all, and split only where it genuinely helps.

WRITE BACK IN THE USER'S OWN LANGUAGE. These instructions are in English; the capture may not be. A Bulgarian capture must come back in Bulgarian, word for word as they said it. Never translate, and never paraphrase into English — this is somebody's diary, and returning it in a language they did not write it in replaces their voice with yours. If the capture mixes languages, keep the mixture exactly as it is.

DEFAULT TO ONE UNIT. Most captures are one entry. Splitting is the exception, not the goal, and returning one unit is a correct and common answer.

The only reason to split is that a part needs to LIVE SOMEWHERE ELSE to be useful later. Ask of each candidate piece: "would the user need to find this on its own, away from the story around it?"
- A thing they must DO belongs in their task list, where they will look for it. Split it out.
- A workout or health note belongs in their log, where it can be tracked over time. Split it out.
- An idea they want to develop belongs with their ideas. Split it out.
- Everything else is the diary entry. It stays whole.

A chronological account of a day is ONE journal entry, however many activities it contains. Going to the city, training, working on something, meeting friends, changing plans — that is one person describing one day, not five entries. Do NOT split a narrative into its events. Do NOT give an opening line like "Today was a nice day" its own unit; it is the beginning of the story, not a separate thought.

TENSE IS DECISIVE for tasks. A task is something NOT YET DONE. "I sorted out the support ticket" is the diary — it already happened. "I need to prepare the tea before we leave" is a task — it has not happened. Past tense is never a task, no matter how action-like the words are.

Spoken filler ("you know", "hmm", "okay so", "like", "I mean") and false starts are not topic changes — remove them from the output text. Add sentence-ending punctuation where it is naturally missing. Never invent, summarise, or drop any of the user's substantive meaning: every substantive part of the original must appear in exactly one unit, in the user's own words and language.

Categories:
- journal: thoughts, feelings, reflections, things that happened, the account of a day. THE DEFAULT.
- task: something not yet done that the user needs to do. Future or intended, never past.
- idea: a concept or possibility they are exploring or want to build.
- log: body, health, workouts, sleep, food, physical sensations ONLY — not general daily narration.

People: extract the human beings named in each unit, exactly as written. Shops, apps, brands, companies and places are NOT people — Temu, Trello, Sofia are not names to return.

Due times: when a task states when it happens, return it as dueAt — AND LEAVE THE WORDS IN THE TEXT. "I need to check back on the app later today at 9pm" becomes text "Check back on the app later today at 9pm" with dueAt set, not text "Check back on the app." The timestamp is for the calendar; the sentence is what the person said, and cutting half of it away to store it elsewhere loses the only version they would recognise. "tonight at 21:20", "утре в 8:30", "Wednesday morning" are all times; resolve them against the current time given below and return a full ISO 8601 timestamp with the offset. Leave dueAt null when no time is stated — most tasks have none, and inventing a deadline puts a reminder in someone's calendar for a moment they never chose.`,
      messages: [{
        role: "user",
        content: [
          // Relative times are the common case in speech — nobody dictates a
          // date — and they cannot be resolved without knowing the speaker's
          // clock. The server's own clock is not it: this is deployed in North
          // America and used in Bulgaria.
          nowIso ? `Current time where the user is: ${nowIso}${zone ? ` (${zone})` : ""}` : "",
          clean,
        ].filter(Boolean).join("\n\n"),
      }],
    });

    const toolUse = response.content.find(b => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return res.json({ units: fallback(), source: "heuristic" });
    }

    const input = toolUse.input as {
      units: { text: string; category: string; people: string[]; dueAt?: string | null }[];
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
        // Only trusted if it parses and is not in the past by more than a day:
        // a model that misreads "утре" as last year would otherwise put a
        // reminder in a calendar for a moment that has already gone.
        dueAt: (() => {
          if (typeof u.dueAt !== "string" || Number.isNaN(Date.parse(u.dueAt))) return null;
          const due = new Date(u.dueAt);
          const floor = Date.now() - 24 * 60 * 60 * 1000;
          return due.getTime() >= floor ? due.toISOString() : null;
        })(),
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
