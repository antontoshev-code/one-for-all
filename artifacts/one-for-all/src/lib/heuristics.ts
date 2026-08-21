// ── Category heuristic ────────────────────────────────────────────────────
//
// Log = SPECIFICALLY body / health / physical tracking.
// General "I did things today" entries default to Journal.

/** The four places a capture can end up. */
export type Category = 'journal' | 'task' | 'idea' | 'log';

export function categorizeContent(text: string): Category {
  const t = text.toLowerCase();

  /**
   * Task words in both languages the app supports.
   *
   * The Bulgarian half was missing entirely, so "За утре имам задача да
   * подготвя чая" read as an ordinary diary sentence and every Bulgarian
   * capture came out as one undifferentiated journal entry.
   *
   * Bulgarian marks intention with the particle "ще" and with "трябва"/"имам
   * задача" rather than with an auxiliary verb, and "утре"/"довечера" carry the
   * future as reliably as "tomorrow" does. What they have in common is that
   * none of them describe something already done — which is the actual test for
   * a task.
   */
  const taskWords = [
    // English
    "need to", "remind", "todo", "must", "should", "don't forget",
    "remember to", "have to", "call", "email", "schedule",
    "pick up", "buy", "check",
    // Bulgarian
    "трябва", "имам задача", "задача да", "не забравя", "да не забравя",
    "напомни", "напомняне", "ще трябва", "предстои", "остава да",
    "да звънна", "да се обадя", "да купя", "да взема", "да напиша",
    "да изпратя", "да проверя", "да подготвя", "да организирам",
    "за утре", "довечера трябва", "следващата седмица трябва",
  ];
  if (taskWords.some(w => t.includes(w))) return 'task';

  const ideaWords = [
    // English
    "idea", "what if", "concept", "maybe we could", "what about",
    "thinking about building", "could be interesting", "perhaps",
    "i want to", "i think i want",
    // Bulgarian
    "идея", "хрумна ми", "какво ако", "би било", "може би трябва да направим",
    "мисля да направя", "искам да направя", "би било интересно",
    "какво ще стане ако", "представям си",
  ];
  if (ideaWords.some(w => t.includes(w))) return 'idea';

  // Log = body / health / physical tracking only
  const logWords = [
    // English
    "workout", "worked out", "exercise", "exercised", "training",
    "ran ", "running", "jogged", "jogging", "sprinted", "cycling", "swam", "swimming",
    "lifted", "gym", "pull-up", "push-up", "bench press", "squat", "deadlift", "reps",
    "slept", "sleep", "woke up", "insomnia", "fatigue",
    "ate ", "eating", "meal", "breakfast", "lunch", "dinner", "calories", "fasting",
    "weight ", "weighed", "bmi", "body fat",
    "heart rate", "pulse", "blood pressure", "steps taken",
    "headache", "stomachache", "pain", "sore", "ache", "symptom", "sick", "fever", "nausea",
    "medication", "vitamins", "supplements",
    // Strength-training vocabulary. "I did my standard calisthenics protocol
    // and 45 kg bench press 3 sets" had one hit in thirteen words and read as
    // narrative, so a plainly physical note was filed as a diary entry and
    // then offered for splitting away from its own first sentence.
    "calisthenics", "sets", "set of", "kg", "bodyweight", "cardio", "stretching",
    "plank", "burpees", "lunges", "curls", "press", "rows", "dips", "chin-up",
    "warm up", "warmed up", "cool down", "protocol", "circuit", "interval",
    "physical", "health", "body", "muscle", "felt great", "felt tired", "energy",
    // Bulgarian
    "тренирах", "тренировка", "тренирам", "фитнес", "бягах", "бягане",
    "плувах", "колело", "лицеви", "коремни", "клекове", "набирания",
    "щанга", "серии", "повторения", "разтягане", "кардио",
    "спах", "сън", "не спах", "събудих се", "умора", "изтощен",
    "закуска", "обяд", "вечеря", "хранене", "калории", "тегло",
    "главоболие", "болка", "боли ме", "схванат", "температура", "болен",
    "лекарство", "витамини", "добавки", "пулс", "кръвно", "енергия", "чувствам се",
  ];
  /**
   * Log needs the sentence to be ABOUT the body, not merely to mention it.
   *
   * "Слязох до София с колата и там тренирах" is a line of narrative that
   * happens to contain a training verb, and calling it a workout log split a
   * day's diary entry in half. One keyword inside a long sentence is a passing
   * mention; two, or one in a short sentence, is the subject.
   */
  const logHits = logWords.filter(w => t.includes(w)).length;
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (logHits >= 2 || (logHits === 1 && wordCount <= 6)) return 'log';

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
 * Shops, apps and services, which are not people.
 *
 * "Очаквах доставка от Тему" offered Тему as somebody to add. A brand read as
 * a person is worse than most mistakes this detector makes, because People is
 * where the app keeps notes about human beings, and a shop has no business
 * sitting among them.
 */
const BRAND_WORDS = new Set([
  "Temu", "Тему", "Amazon", "Амазон", "Ebay", "EBay", "AliExpress", "Али",
  "Emag", "EMag", "Емаг", "Glovo", "Глово", "Wolt", "Волт", "Uber", "Убер",
  "Bolt", "Болт", "Netflix", "Нетфликс", "Spotify", "Спотифай",
  "Youtube", "YouTube", "Ютуб", "Instagram", "Инстаграм", "Facebook", "Фейсбук",
  "Tiktok", "TikTok", "Тикток", "Whatsapp", "WhatsApp", "Viber", "Вайбър",
  "Telegram", "Телеграм", "Gmail", "Google", "Гугъл", "Apple", "Епъл",
  "Microsoft", "Майкрософт", "Revolut", "Револют", "Paypal", "PayPal", "Пейпал",
  "Booking", "Airbnb", "Kaufland", "Кауфланд", "Lidl", "Лидл", "Billa", "Била",
  "Fantastico", "Фантастико", "Технополис", "Jumbo", "Джъмбо", "Практикер",
  "Trello", "Трело", "Notion", "Slack", "Слак", "Figma", "Фигма", "Github",
  "GitHub", "Zoom", "Зуум", "Teams", "Replit", "Реплит",
]);

/**
 * Sentences grouped into units, splitting only where the category changes.
 *
 * Plain sentence splitting turned one evening's diary entry into eight pieces —
 * "Днес беше доста приятен ден." got a card of its own. An account of a day is
 * one entry however many things happened in it, and the reason to separate a
 * part is that it belongs somewhere else: a task in the task list, a workout in
 * the log.
 *
 * So adjacent sentences of the same category stay together, and a boundary only
 * appears where the category changes. That is the same rule the AI splitter is
 * asked to follow, which matters because this runs when the AI is unavailable
 * and the two should not disagree about what a capture is.
 */
export function groupIntoUnits(text: string): { text: string; category: Category }[] {
  const sentences = splitIntoChunks(text);
  if (sentences.length <= 1) {
    return [{ text: text.trim(), category: categorizeContent(text) }];
  }

  const units: { text: string; category: Category }[] = [];

  for (const sentence of sentences) {
    const category = categorizeContent(sentence);
    const last = units[units.length - 1];

    if (last && last.category === category) {
      last.text = `${last.text} ${sentence}`.trim();
    } else {
      units.push({ text: sentence, category });
    }
  }

  return units;
}

/**
 * Whether a capture is worth offering to split.
 *
 * Not simply "more than one sentence" — by that measure almost every capture is
 * multi-part, and the Split button would be promoted over Accept on a diary
 * entry that should stay whole. The question is whether some part of it belongs
 * in a different place, which is exactly what more than one category means.
 */
export function looksWorthSplitting(text: string): boolean {
  return groupIntoUnits(text).length > 1;
}

/**
 * Terms of address — обращения — which name a relationship, not a person.
 *
 * "Дали Вуйчо ще се чувства окей?" should not offer Вуйчо as someone to add:
 * it means uncle. Capitalised at the start of a sentence, or mangled by
 * transcription, these look exactly like names, and Bulgarian has a lot of them
 * because it distinguishes maternal from paternal relatives where English does
 * not.
 *
 * This only suppresses *new* suggestions. Somebody who has created a person
 * called Баба is still matched, because matching an existing person happens
 * before any of these checks.
 */
const ADDRESS_WORDS = new Set([
  // ── Bulgarian ───────────────────────────────────────────────────────────
  "Мама", "Майка", "Татко", "Баща", "Тати", "Тате", "Мамо",
  "Баба", "Дядо", "Син", "Сине", "Дъщеря", "Брат", "Сестра", "Батко", "Кака",
  "Внук", "Внучка", "Вуйчо", "Вуйна", "Чичо", "Стрина", "Леля",
  "Братовчед", "Братовчедка", "Племенник", "Племенница",
  "Зет", "Снаха", "Свекър", "Свекърва", "Тъст", "Тъща",
  "Кум", "Кума", "Кръстник", "Кръстница",
  "Съпруг", "Съпруга", "Годеник", "Годеница", "Гадже",
  "Приятел", "Приятелка", "Колега", "Колежка", "Съсед", "Съседка",
  "Шеф", "Шефе", "Господине", "Госпожо", "Госпожице", "Момче", "Момиче",
  "Миличък", "Миличка", "Скъпи", "Скъпа", "Съкровище",

  // ── English ─────────────────────────────────────────────────────────────
  "Mum", "Mom", "Mummy", "Mommy", "Mother", "Dad", "Daddy", "Father",
  "Grandma", "Grandpa", "Granny", "Grandad", "Granddad", "Grandmother",
  "Grandfather", "Nan", "Nana",
  "Aunt", "Auntie", "Uncle", "Cousin", "Nephew", "Niece",
  "Brother", "Sister", "Son", "Daughter", "Grandson", "Granddaughter",
  "Husband", "Wife", "Partner", "Boss", "Colleague", "Neighbour", "Neighbor",
  "Mate", "Buddy", "Flatmate", "Roommate", "Landlord", "Landlady",
  "Godmother", "Godfather",
]);

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
    // "Вуйчо" means uncle, not somebody called Вуйчо.
    if (ADDRESS_WORDS.has(candidate)) continue;
    // "Тему" is a shop. People is for people.
    if (BRAND_WORDS.has(candidate)) continue;
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
