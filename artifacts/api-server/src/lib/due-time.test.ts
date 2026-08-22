import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { composeDue, DEFAULT_HOUR } from "./due-time.ts";

/** Sofia in summer: three hours ahead, so getTimezoneOffset() reports -180. */
const SOFIA = -180;
const NOW = new Date("2026-08-21T18:00:00Z");

describe("composeDue", () => {
  test("a date with no time lands at midday, not at midnight", () => {
    // "до 25 септември" produced a timestamp that rendered as 26 September at
    // 00:59 — the model doing timezone arithmetic it had no need to do. Noon is
    // visibly a default and leaves the day to act on it.
    const due = composeDue({ date: "2026-09-25" }, SOFIA, NOW);
    assert.ok(due);
    // 12:00 in Sofia is 09:00 UTC.
    assert.equal(due.toISOString(), "2026-09-25T09:00:00.000Z");
  });

  test("the local date is the date that was said", () => {
    const due = composeDue({ date: "2026-09-25" }, SOFIA, NOW)!;
    const local = new Date(due.getTime() - SOFIA * 60_000);
    assert.equal(local.toISOString().slice(0, 10), "2026-09-25");
    assert.equal(local.getUTCHours(), DEFAULT_HOUR);
  });

  test("a stated time is kept exactly", () => {
    const due = composeDue({ date: "2026-08-22", time: "21:20" }, SOFIA, NOW)!;
    assert.equal(due.toISOString(), "2026-08-22T18:20:00.000Z");
  });

  test("midnight is honoured when somebody actually says it", () => {
    const due = composeDue({ date: "2026-08-22", time: "00:30" }, SOFIA, NOW)!;
    assert.equal(due.toISOString(), "2026-08-21T21:30:00.000Z");
  });

  test("works west of Greenwich too", () => {
    // New York in summer is four hours behind, so the offset is +240.
    const due = composeDue({ date: "2026-09-25", time: "09:00" }, 240, NOW)!;
    assert.equal(due.toISOString(), "2026-09-25T13:00:00.000Z");
  });

  test("works at UTC", () => {
    const due = composeDue({ date: "2026-09-25", time: "09:00" }, 0, NOW)!;
    assert.equal(due.toISOString(), "2026-09-25T09:00:00.000Z");
  });

  test("rejects a malformed date", () => {
    for (const date of ["25 September", "2026/09/25", "", "26-09-2026"]) {
      assert.equal(composeDue({ date }, SOFIA, NOW), null, date);
    }
  });

  test("rejects a malformed time rather than guessing", () => {
    for (const time of ["9am", "21", "21:5", "25:00", "10:75"]) {
      assert.equal(composeDue({ date: "2026-09-25", time }, SOFIA, NOW), null, time);
    }
  });

  test("rejects a day that does not exist in that month", () => {
    // Date.UTC rolls 31 February into March without complaining, which would
    // put a reminder on a day nobody named.
    assert.equal(composeDue({ date: "2026-02-31" }, SOFIA, NOW), null);
    assert.equal(composeDue({ date: "2026-13-01" }, SOFIA, NOW), null);
  });

  test("accepts a leap day in a leap year", () => {
    assert.ok(composeDue({ date: "2028-02-29" }, SOFIA, NOW));
  });

  test("rejects a date well in the past", () => {
    assert.equal(composeDue({ date: "2020-01-01" }, SOFIA, NOW), null);
  });

  test("allows today and yesterday, since a capture can be reviewed late", () => {
    assert.ok(composeDue({ date: "2026-08-21", time: "10:00" }, SOFIA, NOW));
  });

  test("rejects a date years away, which is a misread year", () => {
    assert.equal(composeDue({ date: "2126-09-25" }, SOFIA, NOW), null);
  });
});
