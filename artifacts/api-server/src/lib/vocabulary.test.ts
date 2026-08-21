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
  test("never changes the text", () => {
    // It used to. A Bulgarian capture came back with "каква" turned into
    // "кака" and "добрия" into "Добрич" — each one edit from the vocabulary,
    // each already correct. Distance cannot tell a mis-hearing from a real
    // word, so the user decides and the words stay as they were said.
    const text = "Видях се с Пети вчера";
    assert.equal(correctTranscript(text, ["Петя", "Елена"]).text, text);
  });

  test("suggests the name that started this", () => {
    const r = correctTranscript("Видях се с Пети вчера", ["Петя", "Елена"]);
    assert.deepEqual(r.corrections, [{ from: "Пети", to: "Петя" }]);
  });

  test("says nothing about a correctly transcribed name", () => {
    assert.deepEqual(correctTranscript("Видях се с Петя вчера", ["Петя"]).corrections, []);
  });

  test("leaves everyday words alone", () => {
    // These are the four it actually got wrong in use. Each is one edit from
    // something in the vocabulary and each was already right.
    const vocab = ["кака", "майка", "приятел", "Добрич"];
    for (const [sentence, word] of [
      ["каква малка подробност", "каква"],
      ["каква малка подробност", "малка"],
      ["беше много приятен ден", "приятен"],
      ["по възможно най-добрия начин", "добрия"],
    ] as const) {
      const r = correctTranscript(sentence, vocab);
      assert.equal(
        r.corrections.some(c => c.from === word),
        false,
        `should not have proposed a change to "${word}"`,
      );
    }
  });

  test("suggests a mangled place name", () => {
    const r = correctTranscript("пред Солична община", ["Столична"]);
    assert.deepEqual(r.corrections, [{ from: "Солична", to: "Столична" }]);
  });

  test("refuses to guess between two equally close words", () => {
    assert.deepEqual(correctTranscript("видях Дана", ["Дани", "Дара"]).corrections, []);
  });

  test("never touches very short words", () => {
    assert.deepEqual(correctTranscript("Ана дойде", ["Иван"]).corrections, []);
  });

  test("leaves short lowercase words alone", () => {
    assert.deepEqual(correctTranscript("беше дене там", ["Дени"]).corrections, []);
  });

  test("suggests a long lowercase word", () => {
    const r = correctTranscript("направихме тараточе", ["тараторче"]);
    assert.deepEqual(r.corrections, [{ from: "тараточе", to: "тараторче" }]);
  });

  test("does not propose rewriting an ordinary word into vocabulary", () => {
    assert.deepEqual(correctTranscript("направихме си лимонада", ["Елена", "Петя"]).corrections, []);
  });

  test("handles an empty vocabulary", () => {
    assert.deepEqual(correctTranscript("Видях се с Пети", []).corrections, []);
  });

  test("ignores multi-word vocabulary entries", () => {
    assert.deepEqual(correctTranscript("бях в Загорa", ["Стара Загора"]).corrections, []);
  });

  test("says nothing about a word that is already known", () => {
    assert.deepEqual(correctTranscript("използвам TRELLO всеки ден", ["Trello"]).corrections, []);
  });

  test("suggests a kinship term heard as a name", () => {
    const r = correctTranscript("Дали Войчо ще се чувства окей", ADDRESS_BG);
    assert.deepEqual(r.corrections, [{ from: "Войчо", to: "вуйчо" }]);
  });

  test("suggests a loanword carrying a definite article", () => {
    const r = correctTranscript("Справих се с саппорта", LOANWORDS_BG);
    assert.deepEqual(r.corrections, [{ from: "саппорта", to: "съпорта" }]);
  });

  test("says nothing about a loanword that is already right", () => {
    assert.deepEqual(
      correctTranscript("Справих се с съпорта и тикета", LOANWORDS_BG).corrections,
      [],
    );
  });

  test("proposes a repeated word only once", () => {
    const r = correctTranscript("Пети дойде и Пети си тръгна", ["Петя"]);
    assert.equal(r.corrections.length, 1);
  });

  test("requires the first letter to match", () => {
    assert.deepEqual(correctTranscript("направихме лимонада", ["димоната"]).corrections, []);
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
