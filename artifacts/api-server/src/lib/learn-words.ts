/**
 * Works out which words a user corrected by hand.
 *
 * When someone fixes a transcript before saving it, that edit is the most
 * reliable signal available about what they actually said — better than any
 * prompt hint, because it is not a guess. "Дене" becoming "Дани" means the app
 * should stop hearing Дене.
 *
 * Pure, and deliberately so: this decides what gets written into a user's
 * permanent vocabulary, and a bad rule there degrades every future capture.
 */

export interface LearnedWord {
  /** What transcription produced. */
  from: string;
  /** What the user replaced it with — the word worth remembering. */
  to: string;
}

/** Split into words while remembering nothing about punctuation or spacing. */
function words(text: string): string[] {
  return text.match(/\p{L}[\p{L}\p{M}'-]*/gu) ?? [];
}

/**
 * Compare the transcript as delivered against what the user saved, and return
 * the single-word substitutions.
 *
 * Alignment is deliberately naive: only edits that keep the word count and
 * change words in place are learned. Once someone has added or removed words,
 * position no longer identifies the same word, and a mis-alignment would teach
 * the app a substitution nobody made. Rewriting a sentence is common; teaching
 * the wrong lesson from it is worse than learning nothing.
 */
export function learnFromEdit(original: string, edited: string): LearnedWord[] {
  const before = words(original);
  const after = words(edited);

  if (before.length === 0 || before.length !== after.length) return [];

  const learned: LearnedWord[] = [];

  for (let i = 0; i < before.length; i++) {
    const from = before[i];
    const to = after[i];

    if (from === to) continue;
    // Case-only changes are punctuation of a sort, not a different word.
    if (from.toLowerCase() === to.toLowerCase()) continue;

    // Very short words are skipped for the same reason the corrector skips
    // them: at that length half the language is one edit away, and a slip of
    // the thumb would be recorded as vocabulary.
    if (to.length < 4) continue;

    // An unrelated word is a rewrite, not a repair. Learning "лимонада" as the
    // correct hearing of "работа" would poison every later capture.
    if (!looksLikeRepair(from, to)) continue;

    learned.push({ from, to });
  }

  // The same fix twice in one capture is one lesson.
  return [...new Map(learned.map(l => [l.to.toLowerCase(), l])).values()];
}

/**
 * True when two words are close enough that one is plausibly a mis-hearing of
 * the other, rather than a different word entirely.
 *
 * Two rules, because either alone is wrong.
 *
 * The first letter must match. Transcription mangles vowels and endings and
 * keeps the opening consonant — Дене/Дани, Пети/Петя, тараточе/тараторче all
 * share it, while работа/лимонада and сутрин/вечер do not. This single check
 * rejects most rewrites outright and costs nothing.
 *
 * The rest may differ by up to half the word. A third was the first attempt and
 * it failed the case this was built for: "Дене" to "Дани" is two edits in four
 * characters, and a third of four rounds down to one. Half is loose on its own,
 * which is why it is paired with the first-letter rule rather than trusted
 * alone.
 */
export function looksLikeRepair(from: string, to: string): boolean {
  const a = from.toLowerCase();
  const b = to.toLowerCase();
  if (!a || !b) return false;
  if (a[0] !== b[0]) return false;

  const longest = Math.max(a.length, b.length);
  const allowed = Math.max(1, Math.floor(longest / 2));
  if (Math.abs(a.length - b.length) > allowed) return false;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      ));
    }
    prev = row;
  }

  return prev[b.length] <= allowed;
}
