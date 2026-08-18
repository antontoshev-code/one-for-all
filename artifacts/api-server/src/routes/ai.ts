import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/logger";
import { aiRateLimit, MAX_AUDIO_BYTES, MAX_TEXT_CHARS } from "../lib/ai-guard";

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

// ── Multer (audio upload, memory storage, 25 MB limit) ───────────────────

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
// Returns { transcript, source: 'whisper' | 'unavailable' | 'error' }.

router.post("/ai/transcribe", aiRateLimit, upload.single("audio"), async (req, res) => {
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

    const result = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "text",
    });

    const transcript = typeof result === "string" ? result.trim() : "";
    return res.json({ transcript, source: "whisper" });
  } catch (err) {
    logger.error({ err }, "Whisper transcription failed");
    return res.json({ transcript: "", source: "error", reason: String(err) });
  }
});

// ── POST /ai/categorize ───────────────────────────────────────────────────
// Body: { texts: string[] }
// Returns { categories: Category[], source: 'claude' | 'heuristic' }.

router.post("/ai/categorize", aiRateLimit, async (req, res) => {
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
// Returns { names: (string | null)[], source: 'claude' | 'unavailable' | 'error' }.

router.post("/ai/detect-names", aiRateLimit, async (req, res) => {
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
    return res.json({ names: Array(texts.length).fill(null), source: "unavailable" });
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
                  type: "string",
                  description:
                    "The first plausible person name if clearly present, or empty string if none",
                },
                description:
                  "One entry per input text, same order. Use empty string when no person name is found.",
              },
            },
            required: ["names"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "extract_names" },
      system: `Extract the first plausible human person name from each diary/journal snippet.
Rules:
- Only return a name if it clearly refers to a real person being mentioned personally (e.g. "Called Sarah" → "Sarah", "Lunch with Dr. Chen" → "Dr. Chen", "Met James at the gym" → "James")
- Return empty string for: verbs, common nouns, place names, brands, pronouns, months, weekdays, sentence-opening words that happen to be capitalized, or anything ambiguous
- Be conservative — an empty string is always better than a false positive`,
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

    const raw = (toolUse.input as { names?: string[] }).names ?? [];
    const names = texts.map((_, i) => {
      const n = raw[i];
      return typeof n === "string" && n.trim().length > 0 ? n.trim() : null;
    });

    return res.json({ names, source: "claude" });
  } catch (err) {
    logger.error({ err }, "Claude name detection failed");
    return res.json({ names: Array(texts.length).fill(null), source: "error" });
  }
});

// ── POST /ai/split ────────────────────────────────────────────────────────
// Segments a personal capture into semantic thought units using Claude.
// Body: { text: string }
// Returns: { units: Array<{ text, category, people: string[] }>, source: 'claude'|'heuristic' }
// Falls back to punctuation splitting + heuristic categorization if Claude is unavailable.

router.post("/ai/split", aiRateLimit, async (req, res) => {
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
