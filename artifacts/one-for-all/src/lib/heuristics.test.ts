import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectNamesInChunk } from "./heuristics.ts";

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

  test("returns nothing for text with no names", () => {
    assert.deepEqual(detectNamesInChunk("went for a run and made lunch", []), []);
  });
});
