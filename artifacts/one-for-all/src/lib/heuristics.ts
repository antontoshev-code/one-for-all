export function categorizeContent(text: string): 'journal' | 'task' | 'idea' | 'log' {
  const t = text.toLowerCase();
  
  const taskWords = ["need to", "remind", "todo", "must", "should", "don't forget", "remember to", "have to", "call", "email", "schedule", "meet", "pick up", "buy", "check"];
  if (taskWords.some(w => t.includes(w))) return 'task';
  
  const ideaWords = ["idea", "what if", "concept", "maybe we could", "what about", "thinking about building", "could be interesting", "perhaps", "i want to", "i think i want"];
  if (ideaWords.some(w => t.includes(w))) return 'idea';
  
  const logWords = ["did", "went", "finished", "completed", "ran", "worked out", "workout", "ate", "cooked", "watched", "read", "picked up", "got", "had", "met", "saw", "visited"];
  if (logWords.some(w => t.includes(w))) return 'log';
  
  return 'journal';
}

const templates = [
  "Today I went to the store and picked up a few things.",
  "I've been thinking about starting a new project lately.",
  "Need to follow up with Sarah about the meeting next week.",
  "Had a really good workout this morning — felt great.",
  "Got a new idea for the app I've been building.",
  "Finished reading that book I started last month.",
  "Reminder to call mom this weekend.",
  "The weather has been amazing lately, spent time outside.",
  "Thinking about what I want to do differently going forward."
];

export function getMockTranscript(): string {
  const count = Math.floor(Math.random() * 2) + 2;
  const selected = [];
  const pool = [...templates];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return selected.join(" ");
}

// ── Split & Name Detection ──────────────────────────────────────────────────

/**
 * Split a paragraph into individual sentence chunks.
 * Splits on sentence-ending punctuation followed by whitespace.
 */
export function splitIntoChunks(text: string): string[] {
  // Split on . ? ! that are followed by a space or end of string
  const raw = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 3);
  return raw.length > 1 ? raw : [text.trim()];
}

/**
 * Words that appear capitalized in English but are NOT personal names.
 */
const NON_NAME_WORDS = new Set([
  'I', 'A', 'An', 'The', 'This', 'That', 'These', 'Those', 'It', 'He', 'She',
  'We', 'They', 'My', 'Your', 'Our', 'Their', 'His', 'Her', 'Its',
  'Today', 'Tonight', 'Yesterday', 'Tomorrow', 'Morning', 'Evening', 'Night',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Maybe', 'Perhaps', 'Not', 'Also', 'But', 'And', 'So', 'Now', 'Just', 'Well',
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Got', 'Had', 'Was', 'Were', 'Did', 'Have', 'Has', 'Been', 'Will', 'Would',
  'Could', 'Should', 'Must', 'Need', 'Want', 'Let', 'Get', 'Go', 'Put', 'Set',
  'If', 'When', 'Where', 'What', 'Who', 'Why', 'How',
  'Then', 'There', 'Here', 'No', 'Yes', 'Very', 'Really', 'Too', 'Even',
  'Only', 'Some', 'Many', 'All', 'New', 'Old', 'Good', 'Great', 'Bad',
  'Think', 'Thinking', 'Still', 'Again', 'Back', 'Home', 'Work', 'Next',
  'Last', 'First', 'Ok', 'Okay', 'Sure', 'Oh', 'Hmm', 'So',
  'Not', 'Actually', 'Honestly', 'Basically', 'Anyway', 'Though',
]);

export interface NameDetectionResult {
  matchedPerson?: { id: number; name: string };
  suggestedName?: string;
}

/**
 * Detect personal names in a chunk of text.
 * Returns either a matched existing person or a suggested new name to add.
 */
export function detectNamesInChunk(
  chunk: string,
  existingPeople: { id: number; name: string }[]
): NameDetectionResult {
  // Find all capitalized words (Title Case, 2+ chars)
  const capitalizedWords = (chunk.match(/\b[A-Z][a-z]{1,}\b/g) || [])
    .filter(w => !NON_NAME_WORDS.has(w));

  if (capitalizedWords.length === 0) return {};

  // Check against existing people first (case-insensitive first-name match)
  for (const candidate of capitalizedWords) {
    const match = existingPeople.find(p => {
      const firstName = p.name.split(' ')[0].toLowerCase();
      return (
        p.name.toLowerCase() === candidate.toLowerCase() ||
        firstName === candidate.toLowerCase()
      );
    });
    if (match) return { matchedPerson: match };
  }

  // Suggest the first plausible-looking candidate as a potential new person
  const firstCandidate = capitalizedWords[0];
  if (firstCandidate && firstCandidate.length >= 3) {
    return { suggestedName: firstCandidate };
  }

  return {};
}
