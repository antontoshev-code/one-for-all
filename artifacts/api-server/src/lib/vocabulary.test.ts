import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  correctTranscript, editDistance, PLACES_BG, TERMS, ADDRESS_BG, ADDRESS_EN, LOANWORDS_BG, BRANDS,
  stripLeadingFiller,
} from "./vocabulary.ts";

describe("editDistance", () => {
  test("counts single-character edits", () => {
    assert.equal(editDistance("Пети", "Петя", 2), 1);
    assert.equal(editDistance("Dene", "Dani", 2), 2);
  });

  test("bails out once the budget is blown", () => {
    assert.ok(editDistance("completely", "different", 1) > 1);
  });
});

describe("correctTranscript", () => {
  test("repairs the name that started this", () => {
    // Whisper returned "Пети" for "Петя" even with her name in the prompt.
    const r = correctTranscript("Видях се с Пети вчера", ["Петя", "Елена"]);
    assert.equal(r.text, "Видях се с Петя вчера");
    assert.deepEqual(r.corrections, [{ from: "Пети", to: "Петя" }]);
  });

  test("leaves a correctly transcribed name alone", () => {
    const r = correctTranscript("Видях се с Петя вчера", ["Петя"]);
    assert.equal(r.text, "Видях се с Петя вчера");
    assert.deepEqual(r.corrections, []);
  });

  test("repairs a mangled place name", () => {
    const r = correctTranscript("пред Солична община", ["Столична"]);
    assert.equal(r.text, "пред Столична община");
  });

  test("keeps punctuation and spacing intact", () => {
    const r = correctTranscript("Здрасти, Пети! Как си?", ["Петя"]);
    assert.equal(r.text, "Здрасти, Петя! Как си?");
  });

  test("refuses to guess between two equally close words", () => {
    // "Дана" is one edit from both. A coin flip must not edit a diary.
    const r = correctTranscript("видях Дана", ["Дани", "Дара"]);
    assert.equal(r.text, "видях Дана");
    assert.deepEqual(r.corrections, []);
  });

  test("never touches very short words", () => {
    // At three characters almost everything is one edit from something else.
    const r = correctTranscript("Ана дойде", ["Иван"]);
    assert.equal(r.text, "Ана дойде");
  });

  test("leaves short lowercase words alone", () => {
    // "дене" is not claiming to be a name; only a capital letter earns the
    // benefit of the doubt at this length.
    const r = correctTranscript("беше дене там", ["Дени"]);
    assert.equal(r.text, "беше дене там");
  });

  test("repairs a long lowercase word", () => {
    // By nine characters a collision with a real word is vanishingly unlikely,
    // so case stops mattering — this is the тараторче case.
    const r = correctTranscript("направихме тараточе", ["тараторче"]);
    assert.equal(r.text, "направихме тараторче");
  });

  test("does not rewrite ordinary words into vocabulary", () => {
    const r = correctTranscript("направихме си лимонада", ["Елена", "Петя"]);
    assert.equal(r.text, "направихме си лимонада");
  });

  test("allows a wider budget for longer words", () => {
    const r = correctTranscript("бях в Пловдиф днес", ["Пловдив"]);
    assert.equal(r.text, "бях в Пловдив днес");
  });

  test("handles an empty vocabulary without changing anything", () => {
    const r = correctTranscript("Видях се с Пети", []);
    assert.equal(r.text, "Видях се с Пети");
  });

  test("ignores multi-word vocabulary entries when matching one token", () => {
    // "Стара Загора" cannot match a single token, and trying would add noise.
    const r = correctTranscript("бях в Загорa", ["Стара Загора"]);
    assert.deepEqual(r.corrections, []);
  });

  test("is case-insensitive when deciding a word is already known", () => {
    const r = correctTranscript("използвам TRELLO всеки ден", ["Trello"]);
    assert.deepEqual(r.corrections, []);
  });

  test("repairs a kinship term heard as a name", () => {
    // "Дали вуйчо ще се чувства окей?" came back as "Войчо", which then read
    // as a person and was offered as someone to add. One vowel turns the word
    // for uncle into a plausible Bulgarian name.
    const r = correctTranscript("Дали Войчо ще се чувства окей", ADDRESS_BG);
    assert.equal(r.text, "Дали вуйчо ще се чувства окей");
  });

  test("repairs a loanword carrying a definite article", () => {
    // Said "съпорта", heard "саппорта". Bulgarian attaches its article to the
    // word, so the comparison has to happen on the stem and the article be
    // given back afterwards.
    const r = correctTranscript("Справих се с саппорта", LOANWORDS_BG);
    assert.equal(r.text, "Справих се с съпорта");
  });

  test("repairs a loanword without an article", () => {
    const r = correctTranscript("отворихме един тикед", LOANWORDS_BG);
    assert.equal(r.text, "отворихме един тикет");
  });

  test("does not mangle a word that is already right", () => {
    const r = correctTranscript("Справих се с съпорта и тикета", LOANWORDS_BG);
    assert.deepEqual(r.corrections, []);
  });

  test("requires the first letter to match", () => {
    // Without this the generous distance budget would start rewriting
    // unrelated words into vocabulary.
    const r = correctTranscript("направихме лимонада", ["димоната"]);
    assert.deepEqual(r.corrections, []);
  });

  test("ships usable seed lists", () => {
    assert.ok(PLACES_BG.includes("София"));
    assert.ok(PLACES_BG.includes("Столична община"));
    assert.ok(TERMS.includes("тараторче"));
    assert.ok(TERMS.includes("Trello"));
    assert.ok(ADDRESS_BG.includes("вуйчо"));
    assert.ok(ADDRESS_BG.includes("чичо"));
    assert.ok(ADDRESS_EN.includes("uncle"));
    assert.ok(LOANWORDS_BG.includes("съпорт"));
    assert.ok(LOANWORDS_BG.includes("доставка"));
    assert.ok(BRANDS.includes("Тему"));
  });
});

describe("stripLeadingFiller", () => {
  test("removes a bare leading conjunction", () => {
    // "And we're going hiking" — the person did not start with "And".
    assert.equal(
      stripLeadingFiller("And we're going hiking, and I'm really excited"),
      "We're going hiking, and I'm really excited",
    );
  });

  test("removes stacked filler", () => {
    assert.equal(
      stripLeadingFiller("Okay, well, I was trying to understand something"),
      "I was trying to understand something",
    );
  });

  test("removes Bulgarian filler", () => {
    assert.equal(stripLeadingFiller("Ами, днес беше приятен ден"), "Днес беше приятен ден");
    assert.equal(stripLeadingFiller("И се видях с Петя"), "Се видях с Петя");
  });

  test("recapitalises the new first word", () => {
    assert.match(stripLeadingFiller("So we agreed to meet"), /^We agreed/);
  });

  test("leaves a sentence that does not start with filler", () => {
    const text = "Днес беше доста приятен ден";
    assert.equal(stripLeadingFiller(text), text);
  });

  test("does not eat a real word that happens to match", () => {
    // "Right turn at the lights" is not filler; "Right, I need to…" is. The
    // difference is the punctuation.
    assert.equal(stripLeadingFiller("Right turn at the lights"), "Right turn at the lights");
  });

  test("stops after three, so a capture cannot be eaten away", () => {
    const out = stripLeadingFiller("So, well, okay, and, anyway, I went out");
    assert.ok(out.length > 0);
    assert.ok(out.includes("I went out"));
  });

  test("leaves an empty or whitespace-only transcript alone", () => {
    assert.equal(stripLeadingFiller(""), "");
    assert.equal(stripLeadingFiller("   "), "   ");
  });

  test("does not strip filler that is the entire capture", () => {
    // Nothing follows it, so there is no sentence to promote.
    assert.equal(stripLeadingFiller("Okay"), "Okay");
  });
});
