import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  detectNamesInChunk, groupIntoUnits, looksWorthSplitting, categorizeContent,
} from "./heuristics.ts";

const PEOPLE = [
  { id: 1, name: "Petya Ivanova", descriptor: "Studentina" },
  { id: 2, name: "Sarah", descriptor: null },
];

describe("detectNamesInChunk", () => {
  test("finds every name, not just the first", () => {
    // The bug that started this: three people named, one offered.
    const r = detectNamesInChunk("Met Sarah, then James and Elena came over", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Sarah", "James", "Elena"]);
  });

  test("finds Cyrillic names", () => {
    // The old pattern was [A-Z][a-z]{2,} — ASCII only, so a Bulgarian capture
    // matched nothing at all and no name was ever offered.
    const r = detectNamesInChunk("срещнах се с Петя, дойде Калия и Елена", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Петя", "Калия", "Елена"]);
  });

  test("ignores Bulgarian sentence openers", () => {
    // "Вчера" (yesterday) and "Естествено" (naturally) start sentences
    // constantly in a diary and are capitalised exactly like a name.
    const r = detectNamesInChunk("Вчера се срещнах с Петя. Естествено беше приятно.", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Петя"]);
  });

  test("ignores English sentence openers", () => {
    const r = detectNamesInChunk("The meeting went well. This was good.", []);
    assert.deepEqual(r, []);
  });

  test("matches an existing person by first name", () => {
    const r = detectNamesInChunk("Coffee with Petya today", PEOPLE);
    assert.equal(r.length, 1);
    assert.equal(r[0].matchedPerson?.id, 1);
  });

  test("mixes matched and new people in one chunk", () => {
    // One sentence can link someone known and propose someone new.
    const r = detectNamesInChunk("Sarah introduced me to Kalina", PEOPLE);
    assert.equal(r[0].matchedPerson?.id, 2);
    assert.equal(r[1].suggestedName, "Kalina");
  });

  test("asks once when a name repeats", () => {
    const r = detectNamesInChunk("saw Elena today, then Elena left early", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Elena"]);
  });

  test("skips an unknown name that only ever opens a sentence", () => {
    // The evidence for a name is the capital letter, and every sentence starts
    // with one. Without this, "Coffee with Petya" proposes Coffee as a person.
    const r = detectNamesInChunk("Coffee with friends. Elena was late.", []);
    assert.deepEqual(r, []);
  });

  test("still recognises a known person at the start of a sentence", () => {
    // Matching an existing person is evidence in itself, so the position rule
    // must not hide someone already in the address book.
    const r = detectNamesInChunk("Sarah called this morning", PEOPLE);
    assert.equal(r.length, 1);
    assert.equal(r[0].matchedPerson?.id, 2);
  });

  test("skips short unmatched capitalised words", () => {
    // "Met" and "Ran" open sentences far more often than they name anyone.
    const r = detectNamesInChunk("Met Ran Yes", []);
    assert.deepEqual(r, []);
  });

  test("does not offer a country as a person", () => {
    // "разходка до Италия с Елена" offered Италия. A country is capitalised
    // mid-sentence exactly like a name, so nothing in the word's shape
    // separates them.
    const r = detectNamesInChunk("разходка до Италия с Елена", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Елена"]);
  });

  test("does not offer a city as a person", () => {
    const r = detectNamesInChunk("бяхме в Пловдив с Петя", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Петя"]);
  });

  test("does not offer English place names either", () => {
    const r = detectNamesInChunk("flying to Italy with Sarah", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Sarah"]);
  });

  test("does not offer a kinship term as a person", () => {
    // "Вуйчо" means uncle. Capitalised mid-sentence it is indistinguishable
    // from a name by shape alone, and Bulgarian has many of these.
    const r = detectNamesInChunk("питах Вуйчо и Елена вчера", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Елена"]);
  });

  test("does not offer an English kinship term either", () => {
    const r = detectNamesInChunk("asked Grandma and Sarah about it", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Sarah"]);
  });

  test("still matches a person actually called Баба", () => {
    // Suppression applies to new suggestions only. Somebody who created a
    // person under that name must still have them recognised.
    const people = [{ id: 7, name: "Баба", descriptor: null }];
    const r = detectNamesInChunk("говорих с Баба днес", people);
    assert.equal(r[0]?.matchedPerson?.id, 7);
  });

  test("does not offer a shop as a person", () => {
    // "Очаквах доставка от Тему" offered Тему as somebody to add.
    const r = detectNamesInChunk("очаквах доставка от Тему с Елена", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Елена"]);
  });

  test("does not offer an app as a person", () => {
    const r = detectNamesInChunk("wrote it in Notion with Sarah", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Sarah"]);
  });

  test("does not offer a social network as a person", () => {
    // "which couple I'm watching in this video from Twitter" offered Twitter.
    const r = detectNamesInChunk("watching a video from Twitter with Anton", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Anton"]);
  });

  test("returns nothing for text with no names", () => {
    assert.deepEqual(detectNamesInChunk("went for a run and made lunch", []), []);
  });
});

describe("groupIntoUnits", () => {
  test("keeps a day's account as one entry", () => {
    // This capture was split into eight cards, one of which was
    // "Днес беше доста приятен ден." on its own. An account of a day is one
    // entry however many things happened in it.
    const day = "Днес беше доста приятен ден. Очаквах доставка, обаче никой не дойде. " +
      "Слязох до София с колата и там тренирах. После дойде Елена.";
    const units = groupIntoUnits(day);
    assert.equal(units.length, 1);
    assert.equal(units[0].category, "journal");
  });

  test("separates a task from the story around it", () => {
    // The reason to split is that a part belongs somewhere else — a task
    // belongs in the task list, where the user will look for it.
    const text = "Днес беше приятен ден и се видяхме с Елена. За утре имам задача да подготвя чая.";
    const units = groupIntoUnits(text);
    assert.equal(units.length, 2);
    assert.equal(units[0].category, "journal");
    assert.equal(units[1].category, "task");
  });

  test("returns one unit for a single sentence", () => {
    const units = groupIntoUnits("Днес беше доста приятен ден.");
    assert.equal(units.length, 1);
  });

  test("does not lose any text when grouping", () => {
    // Whatever the grouping decides, every word the user said has to survive.
    const text = "Първо изречение. Второ изречение. За утре имам задача да звънна.";
    const joined = groupIntoUnits(text).map(u => u.text).join(" ");
    for (const word of ["Първо", "Второ", "задача", "звънна"]) {
      assert.ok(joined.includes(word), `lost "${word}"`);
    }
  });
});

describe("looksWorthSplitting", () => {
  test("a plain diary entry is not worth splitting", () => {
    // Otherwise the Split button gets promoted over Accept on an entry that
    // should stay whole, which is how eight cards happened.
    assert.equal(
      looksWorthSplitting("Днес беше приятен ден. Видях се с Елена. Беше хубаво."),
      false,
    );
  });

  test("a diary entry containing a task is", () => {
    assert.equal(
      looksWorthSplitting("Днес беше приятен ден. За утре имам задача да подготвя чая."),
      true,
    );
  });
});

describe("categorizeContent in Bulgarian", () => {
  test("recognises a Bulgarian task", () => {
    // The task words were English-only, so every Bulgarian capture came out as
    // one undifferentiated journal entry.
    assert.equal(categorizeContent("За утре имам задача да подготвя чая"), "task");
    assert.equal(categorizeContent("трябва да звънна на Петя"), "task");
  });

  test("recognises a Bulgarian workout", () => {
    assert.equal(categorizeContent("тренирах днес"), "log");
    assert.equal(categorizeContent("спах зле, събудих се уморен"), "log");
  });

  test("recognises a Bulgarian idea", () => {
    assert.equal(categorizeContent("хрумна ми идея за приложението"), "idea");
  });

  test("treats a passing workout mention as narrative", () => {
    // The sentence has to be about the body, not merely contain a word for it.
    assert.equal(
      categorizeContent("Слязох до София с колата и там тренирах"),
      "journal",
    );
  });

  test("still recognises an English workout", () => {
    assert.equal(categorizeContent("Had a great workout this morning, felt great"), "log");
  });
});

describe("workout notes stay whole", () => {
  test("a two-sentence workout note is one log entry", () => {
    // This was offered for splitting: the first sentence read as log, the
    // second as journal, so the app proposed cutting a workout note in half.
    const note = "Had a great workout this evening — felt great. " +
      "I did my standard short calisthenics protocol and 45 kg bench press 3 sets.";
    const units = groupIntoUnits(note);
    assert.equal(units.length, 1);
    assert.equal(units[0].category, "log");
  });

  test("the second sentence alone is still a log", () => {
    assert.equal(
      categorizeContent("I did my standard short calisthenics protocol and 45 kg bench press 3 sets."),
      "log",
    );
  });

  test("it is not offered for splitting", () => {
    assert.equal(
      looksWorthSplitting("Had a great workout this evening — felt great. I did 45 kg bench press 3 sets."),
      false,
    );
  });
});

describe("real captures that went wrong", () => {
  test("matches a person by alias across alphabets", () => {
    // A profile for Елена with "Elena" under Also Known As was not matched
    // when a capture said "Elena" — only the name field was ever compared,
    // which made the aliases feature look broken and offered a second Elena.
    const people = [{ id: 3, name: "Елена", descriptor: "Bella Italiana", aliases: ["Elena"] }];
    const r = detectNamesInChunk("today Elena said she had a great time", people);
    assert.equal(r[0]?.matchedPerson?.id, 3);
  });

  test("still matches by the stored name itself", () => {
    const people = [{ id: 3, name: "Елена", descriptor: null, aliases: ["Elena"] }];
    const r = detectNamesInChunk("видях се с Елена днес", people);
    assert.equal(r[0]?.matchedPerson?.id, 3);
  });

  test("does not offer Bulgarian landmarks as people", () => {
    // "Today we went to the Seven Rila Lakes" offered Rila and Lakes.
    const r = detectNamesInChunk("we went to the Seven Rila Lakes with Elena", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Elena"]);
  });

  test("does not offer God as a person", () => {
    // "как за Бога да направя" proposed Бога.
    const r = detectNamesInChunk("чудя се как за Бога да го направя с Петя", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Петя"]);
  });

  test("does not offer a Bulgarian town as a person", () => {
    const r = detectNamesInChunk("утре пътуваме до град Трън с Елена", []);
    assert.deepEqual(r.map(x => x.suggestedName), ["Елена"]);
  });
});
