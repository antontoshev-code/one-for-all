import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────

type Category = "journal" | "task" | "idea" | "log";
const VALID_CATEGORIES: Category[] = ["journal", "task", "idea", "log"];

// ── Heuristic fallback (mirrors frontend heuristics.ts) ───────────────────

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
    ["did", "went", "finished", "completed", "ran", "worked out", "workout",
      "ate", "cooked", "watched", "read", "picked up", "got", "had", "met",
      "saw", "visited"].some(w => t.includes(w))
  ) return "log";
  return "journal";
}

// ── Multer (audio upload, memory storage, 25 MB limit) ───────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = Router();

// ── POST /ai/transcribe ───────────────────────────────────────────────────
// Accepts multipart/form-data with field "audio".
// Returns { transcript, source: 'whisper' | 'unavailable' | 'error' }.

router.post("/ai/transcribe", upload.single("audio"), async (req, res) => {
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
    const audioFile = new File([req.file.buffer], `recording.${ext}`, {
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

router.post("/ai/categorize", async (req, res) => {
  const { texts } = req.body as { texts: string[] };

  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: "texts must be a non-empty array" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    logger.warn("ANTHROPIC_API_KEY not set — using heuristic categorization");
    return res.json({ categories: texts.map(heuristicCategory), source: "heuristic" });
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-3-haiku-20240307",
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
- journal: personal reflections, feelings, observations, recollections
- task: action items, reminders, things to do (call, buy, schedule, remember to)
- idea: creative thoughts, concepts, what-if proposals, something to build or try
- log: factual records of already-completed events (went, finished, ran, ate, watched, met)`,
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

router.post("/ai/detect-names", async (req, res) => {
  const { texts } = req.body as { texts: string[] };

  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: "texts must be a non-empty array" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.json({ names: Array(texts.length).fill(null), source: "unavailable" });
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-3-haiku-20240307",
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

export default router;
