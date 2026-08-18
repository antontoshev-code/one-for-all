// ── Category heuristic ────────────────────────────────────────────────────
//
// Log = SPECIFICALLY body / health / physical tracking.
// General "I did things today" entries default to Journal.

export function categorizeContent(text: string): 'journal' | 'task' | 'idea' | 'log' {
  const t = text.toLowerCase();

  const taskWords = [
    "need to", "remind", "todo", "must", "should", "don't forget",
    "remember to", "have to", "call", "email", "schedule", "meet",
    "pick up", "buy", "check",
  ];
  if (taskWords.some(w => t.includes(w))) return 'task';

  const ideaWords = [
    "idea", "what if", "concept", "maybe we could", "what about",
    "thinking about building", "could be interesting", "perhaps",
    "i want to", "i think i want",
  ];
  if (ideaWords.some(w => t.includes(w))) return 'idea';

  // Log = body / health / physical tracking only
  const logWords = [
    "workout", "worked out", "exercise", "exercised", "training",
    "ran ", "running", "jogged", "jogging", "sprinted", "cycling", "swam", "swimming",
    "lifted", "gym", "pull-up", "push-up", "bench press", "squat", "deadlift", "reps",
    "slept", "sleep", "woke up", "insomnia", "fatigue",
    "ate ", "eating", "meal", "breakfast", "lunch", "dinner", "calories", "fasting",
    "weight ", "weighed", "bmi", "body fat",
    "heart rate", "pulse", "blood pressure", "steps taken",
    "headache", "stomachache", "pain", "sore", "ache", "symptom", "sick", "fever", "nausea",
    "medication", "vitamins", "supplements",
    "physical", "health", "body", "muscle",
  ];
  if (logWords.some(w => t.includes(w))) return 'log';

  return 'journal';
}

// ── Mock transcript pool ───────────────────────────────────────────────────

const templates = [
  "Today I went to the store and picked up a few things.",
  "I've been thinking about starting a new project lately.",
  "Need to follow up with Sarah about the meeting next week.",
  "Had a great workout this morning — felt great.",
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

// ── Split & Name Detection ────────────────────────────────────────────────

/**
 * Split a paragraph into individual sentence chunks.
 */
export function splitIntoChunks(text: string): string[] {
  const raw = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 3);
  return raw.length > 1 ? raw : [text.trim()];
}

/**
 * Comprehensive stoplist of words that appear capitalised in English prose
 * but are NEVER personal names. Prefer false-negatives (missing a real name)
 * over false-positives (flagging a common word as a person).
 */
const NON_NAME_WORDS = new Set([
  // Pronouns
  'I', 'A', 'An', 'The', 'This', 'That', 'These', 'Those',
  'It', 'He', 'She', 'We', 'They', 'You',
  'My', 'Your', 'Our', 'Their', 'His', 'Her', 'Its',
  'Me', 'Him', 'Us', 'Them',
  'Who', 'Whom', 'Whose', 'Which', 'What',

  // Time — days, months, periods
  'Today', 'Tonight', 'Yesterday', 'Tomorrow',
  'Morning', 'Afternoon', 'Evening', 'Night', 'Midnight',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
  'Week', 'Weeks', 'Month', 'Months', 'Year', 'Years', 'Day', 'Days',
  'Hour', 'Hours', 'Minute', 'Minutes',

  // Time adverbs — these are sentence-starters that look like names
  'Earlier', 'Later', 'Soon', 'Recently', 'Eventually',
  'Finally', 'Already', 'Still', 'Again', 'Always', 'Never', 'Often',
  'Usually', 'Sometimes', 'Rarely', 'Occasionally', 'Frequently',
  'Before', 'After', 'During', 'While', 'Meanwhile', 'Afterwards',
  'Now', 'Then', 'When', 'Once', 'Suddenly', 'Immediately',
  'Around', 'About',

  // Common sentence-starting verbs (past/present/gerunds)
  'Went', 'Got', 'Had', 'Was', 'Were', 'Did', 'Have', 'Has', 'Been',
  'Will', 'Would', 'Could', 'Should', 'Must', 'Need', 'Want',
  'Let', 'Get', 'Go', 'Put', 'Set', 'Take', 'Took',
  // Short past-tense verbs that could look like names when sentence-initial
  'Met', 'Ran', 'Ate', 'Saw', 'Hit', 'Cut', 'Won', 'Lost', 'Sat',
  'Slept', 'Kept', 'Felt', 'Knew', 'Left',
  'Started', 'Finished', 'Completed', 'Tried', 'Trying',
  'Spent', 'Found', 'Came', 'Made', 'Said', 'Told',
  'Brought', 'Bought', 'Realized', 'Noticed', 'Thought',
  'Looked', 'Seemed', 'Turned', 'Decided',
  'Running', 'Going', 'Coming', 'Getting', 'Having', 'Doing',
  'Thinking', 'Feeling', 'Looking', 'Trying', 'Making', 'Taking',
  'Working', 'Talking', 'Seeing', 'Saying', 'Being',
  'Think', 'See', 'Know', 'Like', 'Look', 'Come',

  // Common adverbs / discourse markers
  'Maybe', 'Perhaps', 'Probably', 'Definitely', 'Certainly', 'Obviously',
  'Actually', 'Honestly', 'Basically', 'Anyway', 'Though', 'However',
  'Not', 'Also', 'Just', 'Even', 'Very', 'Really', 'Quite', 'Rather',
  'Too', 'Only', 'Well', 'So', 'Hmm', 'Oh', 'Ok', 'Okay', 'Sure',
  'Still', 'Again', 'Back', 'More', 'Most', 'Much', 'Less', 'Few',
  'Right', 'True', 'Wrong', 'Good', 'Great', 'Bad', 'New', 'Old',

  // Conjunctions / prepositions starting sentences
  'If', 'When', 'Where', 'Why', 'How',
  'But', 'And', 'Or', 'So', 'Yet', 'Nor',
  'Because', 'Since', 'Although', 'Unless', 'Until', 'Whether',
  'As', 'At', 'By', 'For', 'From', 'In', 'Into', 'Of', 'Off',
  'On', 'Out', 'Over', 'To', 'Up', 'With', 'Without',

  // Nouns / phrases that are common sentence-starters but not names
  'Reminder', 'Note', 'Update',
  'Something', 'Nothing', 'Everything', 'Anything',
  'Someone', 'Nobody', 'Everybody', 'Anyone', 'No one',
  'Another', 'Both', 'Either', 'Neither', 'Each', 'Any', 'Every',
  'Some', 'Many', 'All', 'None',
  'Home', 'Work', 'Next', 'Last', 'First',
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
]);

export interface NameDetectionResult {
  matchedPerson?: { id: number; name: string };
  suggestedName?: string;
}

/**
 * Detect personal names in a chunk of text.
 * Strongly prefers under-flagging over false positives.
 */
export function detectNamesInChunk(
  chunk: string,
  existingPeople: { id: number; name: string }[]
): NameDetectionResult {
  // Find capitalised words (Title Case, 3+ chars) that are not in the stoplist
  const capitalizedWords = (chunk.match(/\b[A-Z][a-z]{2,}\b/g) || [])
    .filter(w => !NON_NAME_WORDS.has(w));

  if (capitalizedWords.length === 0) return {};

  // Prefer existing-person matches first
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

  // Suggest the first plausible candidate: must be ≥4 chars and not caught by stoplist.
  // Iterating (not just checking [0]) lets us skip short 3-char words like "Met"
  // and still find the real name that follows.
  for (const candidate of capitalizedWords) {
    if (candidate.length >= 4) {
      return { suggestedName: candidate };
    }
  }

  return {};
}
