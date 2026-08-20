import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatDueDate } from "./utils.ts";

/** A date at a fixed clock time, offset by whole days from now. */
function daysFromNow(days: number, hour = 21, minute = 20): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

describe("formatDueDate", () => {
  test("says today rather than the date", () => {
    // "Today at 21:20" is what the person dictating meant; a date string is
    // what a machine would say back to them.
    assert.match(formatDueDate(daysFromNow(0)), /^Today at /);
  });

  test("says tomorrow", () => {
    assert.match(formatDueDate(daysFromNow(1)), /^Tomorrow at /);
  });

  test("says yesterday for something overdue", () => {
    assert.match(formatDueDate(daysFromNow(-1)), /^Yesterday at /);
  });

  test("names the weekday within the coming week", () => {
    const label = formatDueDate(daysFromNow(3));
    assert.equal(label.startsWith("Today"), false);
    assert.equal(label.startsWith("Tomorrow"), false);
    assert.match(label, / at /);
  });

  test("spells out a date far enough away to be ambiguous", () => {
    // Beyond a week, a weekday name no longer identifies a single day.
    const label = formatDueDate(daysFromNow(30));
    assert.match(label, /\d/);
    assert.match(label, / at /);
  });

  test("includes the time in every form", () => {
    for (const days of [0, 1, -1, 3, 30]) {
      assert.match(formatDueDate(daysFromNow(days)), / at /, `missing time for ${days}`);
    }
  });

  test("treats just-before-midnight today as today", () => {
    // Rounding on elapsed hours rather than calendar days would call 23:59
    // tonight "tomorrow" whenever it is early enough in the morning.
    assert.match(formatDueDate(daysFromNow(0, 23, 59)), /^Today at /);
  });
});
