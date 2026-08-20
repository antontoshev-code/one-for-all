/**
 * Repair proper nouns that transcription mangled.
 *
 * Whisper's `prompt` biases decoding toward words you supply, but it is a hint
 * and nothing more — a capture that named Петя came back with "Пети" despite
 * her being in the prompt. So the names are also checked afterwards, where the
 * answer is deterministic: "Пети" is one character from a word this user
 * actually uses, and no dictionary word, so it is a transcription error.
 *
 * The rules are deliberately timid. Rewriting words in someone's diary is a
 * serious thing to do silently, and a wrong correction is worse than the
 * mis-heard word it replaced — the user can spot "Пети" and fix it, but a
 * confident wrong substitution reads as something they said.
 */

/** Cheap Levenshtein with an early exit once the budget is blown. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev = row;
  }

  return prev[b.length];
}

/**
 * How far a word may be from a known one and still count as the same word.
 *
 * Length alone was the wrong measure: it ruled out anything under five
 * characters, and "Пети" — the exact failure this exists for — is four.
 *
 * Capitalisation carries the missing signal. A capitalised word mid-sentence is
 * already claiming to be a proper noun, which is all this corrects, so a short
 * one can be trusted with an edit that a short ordinary word cannot. Long words
 * get a budget regardless of case, because by seven characters an accidental
 * collision with a real word is vanishingly unlikely.
 */
function budgetFor(word: string): number {
  if (word.length >= 10) return 2;
  if (word.length >= 7) return 1;

  const capitalised = word[0] !== word[0].toLowerCase();
  if (word.length >= 4 && capitalised) return 1;

  // Three characters or fewer, or short and lowercase: almost every word is one
  // edit from another, and "Ана" would start rewriting itself into "Иван".
  return 0;
}

/**
 * Bulgarian place names, so a diary written here does not have to teach the app
 * where it lives.
 *
 * Curated by hand rather than gathered from what users write. A shared list
 * built from people's captures would carry names and places out of one person's
 * private life and into another's transcription, which is precisely what this
 * app promises not to do.
 */
export const PLACES_BG = [
  "София", "Пловдив", "Варна", "Бургас", "Русе", "Стара Загора", "Плевен",
  "Сливен", "Добрич", "Шумен", "Перник", "Хасково", "Ямбол", "Пазарджик",
  "Благоевград", "Велико Търново", "Враца", "Габрово", "Асеновград", "Видин",
  "Казанлък", "Кюстендил", "Кърджали", "Монтана", "Димитровград", "Търговище",
  "Ловеч", "Силистра", "Разград", "Дупница", "Горна Оряховица", "Смолян",
  "Петрич", "Самоков", "Сандански", "Свищов", "Несебър", "Созопол", "Банско",
  "Боровец", "Витоша", "Рила", "Пирин", "Родопи", "Черно море", "Дунав",
  "Столична община", "Люлин", "Младост", "Лозенец", "Студентски град",
  "Борисова градина", "Национален дворец на културата",
];

/**
 * Words that are neither names nor places but get mangled the same way, and
 * that a general model has no reason to know in a Bulgarian sentence.
 */
export const TERMS = [
  "Trello", "Notion", "Slack", "Figma", "GitHub", "Replit", "Claude", "Whisper",
  "тараторче", "таратор", "баница", "лютеница", "мусака", "шопска",
];

export interface CorrectionResult {
  text: string;
  /** What changed, so the user can be shown rather than silently overruled. */
  corrections: { from: string; to: string }[];
}

/**
 * Repair words that are near-misses for the given vocabulary.
 *
 * A word is only replaced when it is not itself a known vocabulary word and
 * exactly one known word sits within its edit budget. Two candidates at the
 * same distance means the guess is a coin flip, and a coin flip has no business
 * editing a diary.
 */
export function correctTranscript(text: string, vocabulary: string[]): CorrectionResult {
  const known = vocabulary.map(w => w.trim()).filter(Boolean);
  if (known.length === 0 || !text) return { text, corrections: [] };

  const knownLower = new Set(known.map(w => w.toLowerCase()));
  const corrections: { from: string; to: string }[] = [];

  // Split on word characters so punctuation and spacing survive untouched.
  const corrected = text.replace(/\p{L}+/gu, token => {
    const lower = token.toLowerCase();
    if (knownLower.has(lower)) return token;

    const budget = budgetFor(token);
    if (budget === 0) return token;

    let best: string | null = null;
    let bestDistance = budget + 1;
    let tied = false;

    for (const word of known) {
      // Only compare against single words; multi-word entries like "Стара
      // Загора" cannot match a single token and would only add noise.
      if (word.includes(" ")) continue;

      const distance = editDistance(lower, word.toLowerCase(), budget);
      if (distance > budget) continue;

      if (distance < bestDistance) {
        best = word;
        bestDistance = distance;
        tied = false;
      } else if (distance === bestDistance && word.toLowerCase() !== best?.toLowerCase()) {
        tied = true;
      }
    }

    if (!best || tied) return token;

    corrections.push({ from: token, to: best });
    return best;
  });

  return { text: corrected, corrections };
}
