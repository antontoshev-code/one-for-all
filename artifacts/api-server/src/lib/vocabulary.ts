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
 * Paired with the first-letter rule below, which does most of the work.
 * Transcription mangles the middle and end of a word and almost never the
 * opening sound, so requiring the first letter to match rejects unrelated words
 * outright and leaves room to be generous about the rest.
 *
 * Generosity is needed. "саппорта" for "съпорт" is two edits after the article
 * is accounted for, and an earlier version capped seven-character words at one
 * edit and so repaired nothing that mattered.
 */
function budgetFor(word: string): number {
  if (word.length >= 7) return Math.max(1, Math.floor(word.length / 3));

  // Five characters is enough to be a real word rather than a coincidence, and
  // the first-letter rule already rejects unrelated candidates — "тикед" would
  // otherwise never reach "тикет".
  if (word.length >= 5) return 1;

  // At four, only a capitalised word earns an edit: it is already claiming to
  // be a proper noun. A short lowercase word gets none, because at that length
  // half the language is one edit from something else.
  const capitalised = word[0] !== word[0].toLowerCase();
  if (word.length === 4 && capitalised) return 1;

  return 0;
}

/**
 * Bulgarian definite articles, which attach to the end of a word.
 *
 * The vocabulary lists base forms, but people speak inflected ones —
 * "съпорта", not "съпорт". Without stripping these, every article-bearing word
 * looks two or three edits away from its own dictionary form and goes
 * uncorrected. Longest first, so "съпортът" loses "ът" rather than "т".
 */
const BG_ARTICLES = ["ият", "ъят", "ята", "ето", "ите", "ът", "ят", "та", "то", "те", "а", "я", "ъ"];

/**
 * Every plausible stem of a word, given Bulgarian's definite articles.
 *
 * One guess is not enough: "саппорта" ends in both "а" and "та", and taking the
 * longer match gives "саппор", which has eaten part of the stem. Which is
 * correct depends on the lemma, which is exactly what is not known yet — so all
 * candidates are produced and the one that finds a match wins.
 */
function articleStems(word: string): string[] {
  const stems: string[] = [];
  for (const article of BG_ARTICLES) {
    if (word.length > article.length + 2 && word.endsWith(article)) {
      stems.push(word.slice(0, -article.length));
    }
  }
  return stems;
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
  "Twitter", "Туитър", "X", "Reddit", "LinkedIn", "Pinterest", "Snapchat",
  "Twitch", "Discord", "Threads", "Bluesky", "Mastodon", "Substack", "Medium",
  "Dropbox", "OneDrive", "iCloud", "Outlook", "Chrome", "Safari", "Firefox",
  "Windows", "Android", "iPhone", "iPad", "Steam", "Xbox", "PlayStation",
  "Wikipedia", "Уикипедия", "ChatGPT", "OpenAI", "Anthropic", "Gemini",
  "Canva", "Miro", "Asana", "Jira", "Airtable", "Shopify", "Stripe", "Wise",
  "Yettel", "Vivacom", "Ryanair", "Wizz", "IKEA", "Икеа", "Decathlon",
  "Starbucks", "KFC",
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
  const known = vocabulary.map(w => w.trim()).filter(Boolean).filter(w => !w.includes(" "));
  if (known.length === 0 || !text) return { text, corrections: [] };

  const knownLower = new Set(vocabulary.map(w => w.trim().toLowerCase()));
  const corrections: { from: string; to: string }[] = [];

  /**
   * The single closest known word, or null when nothing is close enough or two
   * candidates tie. A tie is a coin flip, and a coin flip has no business
   * editing a diary.
   */
  const closest = (token: string): string | null => {
    const lower = token.toLowerCase();
    const budget = budgetFor(token);
    if (budget === 0) return null;

    let best: string | null = null;
    let bestDistance = budget + 1;
    let tied = false;

    for (const word of known) {
      const candidate = word.toLowerCase();
      // Transcription mangles the middle and end of a word, almost never the
      // opening sound. Requiring it to match rejects unrelated words outright.
      if (candidate[0] !== lower[0]) continue;

      const distance = editDistance(lower, candidate, budget);
      if (distance > budget) continue;

      if (distance < bestDistance) {
        best = word;
        bestDistance = distance;
        tied = false;
      } else if (distance === bestDistance && candidate !== best?.toLowerCase()) {
        tied = true;
      }
    }

    return tied ? null : best;
  };

  // Split on word characters so punctuation and spacing survive untouched.
  const corrected = text.replace(/\p{L}+/gu, token => {
    const lower = token.toLowerCase();
    if (knownLower.has(lower)) return token;

    const stems = articleStems(token);

    // An inflected form of a word already in the vocabulary is correct as it
    // stands. Without this check, "съпорта" gets "corrected" to "съпорт" —
    // stripping the article off a word that was right all along.
    if (stems.some(stem => knownLower.has(stem.toLowerCase()))) return token;

    const direct = closest(token);
    if (direct) {
      corrections.push({ from: token, to: direct });
      return direct;
    }

    // Bulgarian attaches its definite article to the end of the word, so
    // "саппорта" has to be compared as "саппорт" and then given its article
    // back. Without this every inflected word sits an extra edit or two from
    // its own dictionary form and nothing is ever repaired.
    for (const stem of stems) {
      const match = closest(stem);
      if (!match) continue;
      const rebuilt = match + token.slice(stem.length);
      corrections.push({ from: token, to: rebuilt });
      return rebuilt;
    }

    return token;
  });

  return { text: corrected, corrections };
}

/**
 * Terms of address and kinship — обращения.
 *
 * These caused a bug worth remembering: a capture asking "Дали вуйчо ще се
 * чувства окей?" came back as "Войчо", which then read as a person's name and
 * was offered as someone to add. A general model has no reason to expect
 * "вуйчо" in the middle of a sentence about a trip, and one vowel is all it
 * takes to turn a word for uncle into a plausible Bulgarian name.
 *
 * They matter more than ordinary vocabulary because of what they are: the words
 * people use for the people closest to them. A diary is full of them, and every
 * one that transcribes wrong looks like a stranger.
 *
 * Bulgarian distinguishes maternal and paternal relatives where English does
 * not — вуйчо is a mother's brother, чичо a father's — so both are listed
 * rather than collapsed.
 */
export const ADDRESS_BG = [
  // Immediate family
  "мама", "майка", "татко", "баща", "тати", "мамо", "тате",
  "баба", "дядо", "син", "сине", "дъщеря", "дъще", "брат", "сестра",
  "батко", "кака", "внук", "внучка", "правнук", "правнучка",
  // Extended, where Bulgarian is more precise than English
  "вуйчо", "вуйна", "чичо", "стрина", "леля", "вуйчовци",
  "братовчед", "братовчедка", "племенник", "племенница",
  // In-laws and the wedding party, which Bulgarian names carefully
  "зет", "снаха", "свекър", "свекърва", "тъст", "тъща", "шурей", "балдъза",
  "кум", "кума", "кръстник", "кръстница",
  // Partners
  "съпруг", "съпруга", "мъж", "жена", "годеник", "годеница", "гадже",
  // Everyday address
  "приятел", "приятелка", "колега", "колежка", "съсед", "съседка",
  "шеф", "шефе", "господине", "госпожо", "госпожице", "момче", "момиче",
  "миличък", "миличка", "скъпи", "скъпа", "съкровище", "сърце", "душа",
];

export const ADDRESS_EN = [
  "mum", "mom", "mummy", "mommy", "mother", "dad", "daddy", "father",
  "grandma", "grandpa", "granny", "grandad", "granddad", "grandmother",
  "grandfather", "nan", "nana",
  "aunt", "auntie", "uncle", "cousin", "nephew", "niece",
  "brother", "sister", "son", "daughter", "grandson", "granddaughter",
  "husband", "wife", "partner", "fiancé", "fiancée",
  "stepmum", "stepdad", "mother-in-law", "father-in-law",
  "godmother", "godfather", "godson", "goddaughter",
  "boss", "colleague", "neighbour", "neighbor", "mate", "buddy", "flatmate",
  "roommate", "landlord", "landlady",
];

/**
 * Чуждици — loanwords Bulgarian has absorbed and spells its own way.
 *
 * These break transcription in a particular way: the word is English, so the
 * model reaches for an English spelling or an invented Bulgarian one, and the
 * result is a word nobody writes. "саппорта" for "съпорта" is the shape of it —
 * recognisably the right word, spelled as nothing at all.
 *
 * They are unavoidable in a Bulgarian diary because they are simply how people
 * speak: nobody says "поддръжка" when they mean support, or "приложение" when
 * they mean the app on their phone.
 */
export const LOANWORDS_BG = [
  // Work and software, where the borrowing is heaviest
  "съпорт", "тикет", "имейл", "мейл", "линк", "файл", "бекъп", "ъпдейт",
  "ъпгрейд", "даунлоуд", "ъплоуд", "лаптоп", "десктоп", "сървър", "браузър",
  "акаунт", "профил", "чат", "пост", "лайк", "скрийншот", "апликация",
  "софтуер", "хардуер", "бъг", "фийчър", "деплой", "билд", "код", "дизайн",
  "интерфейс", "юзър", "клиент", "мениджър", "мениджмънт", "маркетинг",
  "бранд", "брандинг", "стартъп", "инвеститор", "презентация", "митинг",
  "дедлайн", "репорт", "фийдбек", "брейнсторм", "уъркшоп", "тиймбилдинг",
  "онбординг", "аутсорсинг", "фрийланс", "ремоут", "офис", "рисърч",
  "пароли", "парола", "линкове", "апдейт", "нотификация", "абонамент",

  // Shopping and delivery
  "доставка", "доставчик", "куриер", "пратка", "поръчка", "онлайн",
  "оферта", "ваучер", "промоция", "дисконт", "кеш", "транзакция", "превод",
  "рефънд", "рекламация", "гаранция", "касова", "банкомат",

  // Getting about and going out
  "паркинг", "асансьор", "супермаркет", "мол", "ресторант", "меню",
  "резервация", "билет", "трамвай", "тролей", "метро", "автобус", "такси",
  "летище", "хотел", "апартамент", "тераса", "гараж", "бариера",

  // Training, which lands in the log category
  "тренировка", "тренирах", "фитнес", "кардио", "стречинг", "серия",
  "повторения", "лицеви", "коремни", "клек", "набирания", "щанга", "дъмбел",
  "протеин", "креатин", "бургер", "смути", "шейк",
];

/**
 * Shops, apps and services that appear in a diary and are not people.
 *
 * "Очаквах доставка от Тему" offered Тему as somebody to add. A brand read as
 * a person is worse than most mistakes here, because People is where the app
 * keeps notes about human beings and a shop does not belong among them.
 */
export const BRANDS = [
  "Temu", "Тему", "Amazon", "Амазон", "eBay", "Ebay", "AliExpress",
  "Emag", "eMag", "Глово", "Glovo", "Wolt", "Волт", "Uber", "Убер", "Bolt",
  "Netflix", "Спотифай", "Spotify", "YouTube", "Ютуб", "Instagram", "Инстаграм",
  "Facebook", "Фейсбук", "TikTok", "Тикток", "WhatsApp", "Вайбър", "Viber",
  "Telegram", "Телеграм", "Gmail", "Google", "Гугъл", "Apple", "Епъл",
  "Microsoft", "Майкрософт", "Revolut", "Револют", "PayPal", "Пейпал",
  "Booking", "Airbnb", "Kaufland", "Кауфланд", "Lidl", "Лидл", "Billa", "Била",
  "Fantastico", "Фантастико", "DM", "Технополис", "Емаг", "Джъмбо", "Jumbo",
];

/**
 * Discourse markers that transcription puts at the front of a capture.
 *
 * "And we're going hiking" — the person did not start with "And". Speech
 * recognition hears the breath and hesitation before a thought and renders it
 * as a conjunction, so nearly every voice capture opens with one. It reads as
 * though the diary entry is continuing a conversation that never happened.
 *
 * Only stripped at the very start, and only these words. "И" is a real word in
 * the middle of a Bulgarian sentence, and "So we agreed" says something that
 * "we agreed" does not.
 */
const LEADING_FILLER = [
  // English
  "and", "so", "okay", "ok", "well", "um", "uh", "erm", "like", "yeah", "right",
  "anyway", "basically", "actually", "i mean",
  // Bulgarian
  "и", "ами", "значи", "така", "добре", "ъъ", "ееее", "еми", "нали", "тъй",
];

/**
 * Remove the filler a transcription put in front of the first real word.
 *
 * Runs a few times, because "Okay, well, I was trying to…" stacks two of them.
 * Stops at three so a capture that genuinely begins with a run of short words
 * cannot be eaten away.
 */
export function stripLeadingFiller(text: string): string {
  let out = text.trimStart();

  for (let i = 0; i < 3; i++) {
    // A marker only counts when punctuation or a following word separates it
    // from the sentence — "Right, I need to…" is filler, "Right turn at the
    // lights" is not.
    const match = /^([\p{L}]+(?:\s+[\p{L}]+)?)\s*[,.]\s+(?=\p{L})/u.exec(out);
    if (!match) break;
    if (!LEADING_FILLER.includes(match[1].toLowerCase())) break;
    out = out.slice(match[0].length);
  }

  // A bare conjunction with no comma after it — "And we're going hiking".
  const bare = /^(and|so|и)\s+(?=\p{L})/iu.exec(out);
  if (bare) out = out.slice(bare[0].length);

  if (out === text.trimStart()) return text;

  // Whatever now starts the sentence has to be capitalised, since the word that
  // was capitalised has gone.
  return out.charAt(0).toLocaleUpperCase() + out.slice(1);
}
