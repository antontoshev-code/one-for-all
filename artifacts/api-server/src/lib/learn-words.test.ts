import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { learnFromEdit, looksLikeRepair } from "./learn-words.ts";

describe("looksLikeRepair", () => {
  test("accepts a plausible mis-hearing", () => {
    assert.ok(looksLikeRepair("Дене", "Дани"));
    assert.ok(looksLikeRepair("Пети", "Петя"));
    assert.ok(looksLikeRepair("тараточе", "тараторче"));
  });

  test("rejects an unrelated word", () => {
    assert.equal(looksLikeRepair("работа", "лимонада"), false);
    assert.equal(looksLikeRepair("сутрин", "вечер"), false);
  });
});

describe("learnFromEdit", () => {
  test("learns a name the user fixed", () => {
    const learned = learnFromEdit("Видях се с Дене вчера", "Видях се с Дани вчера");
    assert.deepEqual(learned, [{ from: "Дене", to: "Дани" }]);
  });

  test("learns nothing when the user changed nothing", () => {
    assert.deepEqual(learnFromEdit("Видях се с Дани", "Видях се с Дани"), []);
  });

  test("ignores punctuation-only differences", () => {
    assert.deepEqual(learnFromEdit("Здрасти Дани", "Здрасти, Дани!"), []);
  });

  test("ignores a change of case", () => {
    assert.deepEqual(learnFromEdit("видях дани", "видях Дани"), []);
  });

  test("refuses to learn from a rewrite", () => {
    // Words were added, so position no longer identifies the same word and any
    // pairing would be invented.
    assert.deepEqual(
      learnFromEdit("Видях Дене", "Видях Дани вчера следобед"),
      [],
    );
  });

  test("refuses to learn an unrelated substitution", () => {
    // Same word count, but this is the user rewriting, not repairing.
    assert.deepEqual(learnFromEdit("направих работа днес", "направих лимонада днес"), []);
  });

  test("skips very short words", () => {
    assert.deepEqual(learnFromEdit("видях Ана там", "видях Иво там"), []);
  });

  test("learns several fixes at once", () => {
    const learned = learnFromEdit(
      "Видях Дене и Пети снощи",
      "Видях Дани и Петя снощи",
    );
    assert.deepEqual(learned.map(l => l.to), ["Дани", "Петя"]);
  });

  test("records the same fix once", () => {
    const learned = learnFromEdit("Дене дойде и Дене си тръгна", "Дани дойде и Дани си тръгна");
    assert.equal(learned.length, 1);
  });

  test("handles empty input", () => {
    assert.deepEqual(learnFromEdit("", "нещо ново"), []);
  });
});
