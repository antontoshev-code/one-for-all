import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { utcDay, hoursUntilReset, checkQuota, type Limits } from "./ai-quota.ts";

const LIMITS: Limits = { requests: 40, audioBytes: 6 * 1024 * 1024 };
const MB = 1024 * 1024;

describe("utcDay", () => {
  test("formats as YYYY-MM-DD", () => {
    assert.equal(utcDay(new Date("2026-08-19T13:45:00Z")), "2026-08-19");
  });

  test("uses UTC, not local time", () => {
    // Anton is UTC+3. A local-time day key would roll over at 21:00 UTC and
    // hand him a fresh allowance three hours early, every day.
    assert.equal(utcDay(new Date("2026-08-19T23:59:59Z")), "2026-08-19");
    assert.equal(utcDay(new Date("2026-08-20T00:00:00Z")), "2026-08-20");
  });
});

describe("hoursUntilReset", () => {
  test("counts to the next UTC midnight", () => {
    assert.equal(hoursUntilReset(new Date("2026-08-19T22:00:00Z")), 2);
  });

  test("never reports zero hours", () => {
    // Ceil already avoids 0 for any time with seconds left, but exactly
    // midnight would floor to 0 and read as "try again immediately".
    assert.equal(hoursUntilReset(new Date("2026-08-19T00:00:00Z")), 24);
    assert.ok(hoursUntilReset(new Date("2026-08-19T23:59:59Z")) >= 1);
  });
});

describe("checkQuota", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  test("allows a user well under both ceilings", () => {
    const v = checkQuota({ requests: 3, audioBytes: MB }, LIMITS, 0, now);
    assert.equal(v.allowed, true);
  });

  test("allows the very last request in the allowance", () => {
    // 39 spent, limit 40 — this call is the 40th and must go through.
    const v = checkQuota({ requests: 39, audioBytes: 0 }, LIMITS, 0, now);
    assert.equal(v.allowed, true);
  });

  test("blocks once the request allowance is spent", () => {
    const v = checkQuota({ requests: 40, audioBytes: 0 }, LIMITS, 0, now);
    assert.equal(v.allowed, false);
    assert.equal(v.allowed === false && v.reason, "requests");
  });

  test("counts the incoming upload, not just what was already spent", () => {
    // 5MB used of 6MB, and a 2MB upload arrives. Checking only prior usage
    // would let it through and bill for 7MB against a 6MB ceiling.
    const v = checkQuota({ requests: 1, audioBytes: 5 * MB }, LIMITS, 2 * MB, now);
    assert.equal(v.allowed, false);
    assert.equal(v.allowed === false && v.reason, "audio");
  });

  test("allows an upload that exactly fills the allowance", () => {
    const v = checkQuota({ requests: 1, audioBytes: 4 * MB }, LIMITS, 2 * MB, now);
    assert.equal(v.allowed, true);
  });

  test("ignores the audio ceiling for text-only calls", () => {
    // Categorise and split send no audio. A user who has used all their
    // transcription minutes must still be able to organise typed captures.
    const v = checkQuota({ requests: 1, audioBytes: 99 * MB }, LIMITS, 0, now);
    assert.equal(v.allowed, true);
  });

  test("checks requests before audio", () => {
    const v = checkQuota({ requests: 40, audioBytes: 99 * MB }, LIMITS, 5 * MB, now);
    assert.equal(v.allowed === false && v.reason, "requests");
  });

  test("tells the user their work is still saved", () => {
    // The limit must never read as data loss. Whatever else it says, it has to
    // say the capture survived.
    const v = checkQuota({ requests: 40, audioBytes: 0 }, LIMITS, 0, now);
    assert.ok(v.allowed === false && /still save/i.test(v.detail));
  });

  test("reports hours until reset in the message", () => {
    const late = new Date("2026-08-19T22:30:00Z");
    const v = checkQuota({ requests: 40, audioBytes: 0 }, LIMITS, 0, late);
    assert.ok(v.allowed === false && v.detail.includes("2 hours"));
  });
});
