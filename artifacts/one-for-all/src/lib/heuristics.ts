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
 * Used as the heuristic fallback when the AI split endpoint is unavailable.
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
/**
 * Places, which are capitalised exactly like people and are not people.
 *
 * "разходка до Италия с Елена" offered Италия as a person to add. The detector
 * works on "capitalised word mid-sentence", and a country satisfies that as
 * well as a name does — nothing in the shape of the word distinguishes them, so
 * they have to be listed.
 *
 * Countries first: a diary talks about travelling far more often than it names
 * a city, and a wrongly offered country is the one a user will hit first.
 */
const PLACE_WORDS = new Set([
  // ── Countries, Bulgarian ────────────────────────────────────────────────
  "България", "Италия", "Германия", "Франция", "Испания", "Гърция", "Турция",
  "Румъния", "Сърбия", "Македония", "Албания", "Хърватия", "Словения",
  "Австрия", "Швейцария", "Белгия", "Холандия", "Нидерландия", "Дания",
  "Швеция", "Норвегия", "Финландия", "Полша", "Чехия", "Словакия", "Унгария",
  "Украйна", "Русия", "Англия", "Ирландия", "Шотландия", "Португалия",
  "Америка", "Канада", "Мексико", "Бразилия", "Аржентина", "Египет", "Мароко",
  "Япония", "Китай", "Индия", "Тайланд", "Виетнам", "Австралия",
  "Кипър", "Малта", "Исландия", "Естония", "Латвия", "Литва", "Грузия",

  // ── Cities and regions, Bulgarian ───────────────────────────────────────
  "София", "Пловдив", "Варна", "Бургас", "Русе", "Плевен", "Сливен", "Добрич",
  "Шумен", "Перник", "Хасково", "Ямбол", "Пазарджик", "Благоевград", "Враца",
  "Габрово", "Асеновград", "Видин", "Казанлък", "Кюстендил", "Кърджали",
  "Монтана", "Димитровград", "Търговище", "Ловеч", "Силистра", "Разград",
  "Дупница", "Смолян", "Петрич", "Самоков", "Сандански", "Свищов", "Несебър",
  "Созопол", "Банско", "Боровец", "Витоша", "Рила", "Пирин", "Родопи",
  "Дунав", "Люлин", "Младост", "Лозенец", "Столична",
  "Берлин", "Париж", "Лондон", "Рим", "Милано", "Виена", "Прага", "Атина",
  "Истанбул", "Мадрид", "Барселона", "Амстердам", "Брюксел", "Будапеща",

  // ── English ─────────────────────────────────────────────────────────────
  "Bulgaria", "Italy", "Germany", "France", "Spain", "Greece", "Turkey",
  "Romania", "Serbia", "Austria", "Switzerland", "Belgium", "Netherlands",
  "Denmark", "Sweden", "Norway", "Finland", "Poland", "Czechia", "Hungary",
  "Ukraine", "Russia", "England", "Ireland", "Scotland", "Portugal",
  "America", "Canada", "Mexico", "Brazil", "Egypt", "Morocco", "Japan",
  "China", "India", "Thailand", "Vietnam", "Australia", "Europe",
  "Sofia", "Plovdiv", "Varna", "Burgas", "Berlin", "Paris", "London", "Rome",
  "Milan", "Vienna", "Prague", "Athens", "Istanbul", "Madrid", "Barcelona",
  "Amsterdam", "Brussels", "Budapest", "Lisbon", "Dublin", "Edinburgh",
]);

/**
 * Words that look like names but aren't.
 *
 * Both languages the app is used in are listed, because the detector works on
 * "capitalised word" and every sentence starts with one. The Bulgarian half
 * matters more than it looks: Cyrillic detection only started working with this
 * change, so without these every capture would offer "Вчера" or "Днес" as a
 * person. Add to the right section when a false positive shows up rather than
 * loosening the detector.
 */
const NON_NAME_WORDS = new Set([
  // ── Bulgarian ──────────────────────────────────────────────────────────
  // Time words, which open sentences constantly in a diary
  'Вчера', 'Днес', 'Утре', 'Сега', 'Тогава', 'Снощи', 'Сутринта',
  'Вечерта', 'Довечера', 'Понеделник', 'Вторник', 'Сряда', 'Четвъртък',
  'Петък', 'Събота', 'Неделя', 'Януари', 'Февруари', 'Март', 'Април',
  'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември',
  // Common sentence openers and connectives
  'Аз', 'Ние', 'Той', 'Тя', 'Те', 'Това', 'Този', 'Тази', 'Тези', 'Онова',
  'Има', 'Няма', 'Беше', 'Бях', 'Бяхме', 'Съм', 'Ще', 'Мога', 'Трябва',
  'Много', 'Малко', 'Добре', 'Защото', 'Обаче', 'Също', 'Освен',
  'После', 'Първо', 'Второ', 'Накрая', 'Изобщо', 'Естествено', 'Между',
  'Съответно', 'Въобще', 'Доста', 'Как', 'Кога', 'Какво', 'Къде', 'Защо',
  'Направихме', 'Работихме', 'Говорихме', 'Обсъдихме', 'Показах',

  // ── English ────────────────────────────────────────────────────────────
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
  /** Single unambiguous person match */
  matchedPerson?: { id: number; name: string; descriptor?: string | null };
  /** Multiple people with the same name — needs disambiguation chooser */
  matchedPeople?: { id: number; name: string; descriptor?: string | null }[];
  /** No match — suggest creating a new person with this name */
  suggestedName?: string;
}

/**
 * Find every person name in a chunk, one result per distinct name.
 *
 * Two things were wrong before. It returned after the first candidate, so a
 * capture naming three people offered one — and the pattern was `[A-Z][a-z]{2,}`,
 * which is ASCII-only and cannot match a single Cyrillic letter. For a diary
 * written mostly in Bulgarian that meant this never fired at all.
 *
 * Unicode property escapes fix both scripts at once: \p{Lu} is any uppercase
 * letter in any alphabet, so Петя and Sarah are found by the same rule.
 *
 * Still biased toward missing names rather than inventing them. A missed name
 * costs one tap to add; a false one puts a stranger in someone's diary.
 */
export function detectNamesInChunk(
  chunk: string,
  existingPeople: { id: number; name: string; descriptor?: string | null }[]
): NameDetectionResult[] {
  const results: NameDetectionResult[] = [];
  const seen = new Set<string>();

  for (const match of chunk.matchAll(/\p{Lu}\p{Ll}{2,}/gu)) {
    const candidate = match[0];
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;

    const matches = existingPeople.filter(p => {
      const firstName = p.name.split(' ')[0].toLowerCase();
      return p.name.toLowerCase() === key || firstName === key;
    });

    if (matches.length > 0) {
      seen.add(key);
      results.push(matches.length > 1 ? { matchedPeople: matches } : { matchedPerson: matches[0] });
      continue;
    }

    // Nobody by this name is known, so the only evidence is the capital letter
    // — and every sentence starts with one. "Coffee with Petya" would otherwise
    // propose Coffee as a person, and no stoplist ever finishes that fight in
    // two languages. A known name is still recognised at the start of a
    // sentence, because the match itself is the evidence there.
    if (isSentenceInitial(chunk, match.index ?? 0)) continue;
    if (NON_NAME_WORDS.has(candidate)) continue;
    // A country reads exactly like a name to this detector. "разходка до
    // Италия с Елена" offered Италия as a person to add.
    if (PLACE_WORDS.has(candidate)) continue;
    if (candidate.length < 4) continue;

    seen.add(key);
    results.push({ suggestedName: candidate });
  }

  return results;
}

/** True when nothing but whitespace and sentence-ending punctuation precedes the word. */
const SENTENCE_ENDERS = new Set([".", "!", "?", "…"]);

function isSentenceInitial(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  if (before.length === 0) return true;
  return SENTENCE_ENDERS.has(before[before.length - 1]);
}
