import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, googleCalendarUrl } from "./calendar.ts";

const BASE = {
  title: "Feedback session with Petya",
  start: new Date("2026-08-20T18:20:00Z"),
  uid: "one-for-all-entry-42",
};

function lines(ics: string): string[] {
  return ics.split("\r\n");
}

describe("buildIcs", () => {
  test("produces a well-formed calendar", () => {
    const l = lines(buildIcs(BASE));
    assert.equal(l[0], "BEGIN:VCALENDAR");
    assert.ok(l.includes("END:VCALENDAR"));
    assert.ok(l.includes("BEGIN:VEVENT"));
    assert.ok(l.includes("END:VEVENT"));
  });

  test("writes the start time as UTC without punctuation", () => {
    assert.ok(buildIcs(BASE).includes("DTSTART:20260820T182000Z"));
  });

  test("defaults to an hour", () => {
    assert.ok(buildIcs(BASE).includes("DTEND:20260820T192000Z"));
  });

  test("honours an explicit duration", () => {
    const ics = buildIcs({ ...BASE, durationMinutes: 30 });
    assert.ok(ics.includes("DTEND:20260820T185000Z"));
  });

  test("uses CRLF line endings", () => {
    // Some calendar applications reject a file that uses bare LF.
    const ics = buildIcs(BASE);
    assert.ok(ics.includes("\r\n"));
    assert.equal(/[^\r]\n/.test(ics), false, "found a bare LF");
  });

  test("carries a stable uid so re-adding updates rather than duplicates", () => {
    assert.ok(buildIcs(BASE).includes("UID:one-for-all-entry-42"));
  });

  test("includes a reminder before the event", () => {
    const ics = buildIcs(BASE);
    assert.ok(ics.includes("BEGIN:VALARM"));
    assert.ok(ics.includes("TRIGGER:-PT10M"));
  });

  test("escapes the characters iCalendar treats as structure", () => {
    const ics = buildIcs({ ...BASE, title: "Call Petya; then Elena, about work" });
    assert.ok(ics.includes("Call Petya\\; then Elena\\, about work"));
  });

  test("escapes backslashes before anything else", () => {
    // Escaping in the wrong order leaves the file full of stray slashes.
    const ics = buildIcs({ ...BASE, title: "path\\to\\thing" });
    assert.ok(ics.includes("path\\\\to\\\\thing"));
  });

  test("turns a newline into its escape rather than breaking the line", () => {
    const ics = buildIcs({ ...BASE, title: "First line\nSecond line" });
    assert.ok(ics.includes("First line\\nSecond line"));
    assert.equal(ics.includes("SUMMARY:First line\r\nSecond"), false);
  });

  test("folds long lines, counting bytes not characters", () => {
    // Cyrillic is two bytes per character, so a Bulgarian task measured in
    // characters produces lines that are technically too long.
    const long = "Обсъждане на задачите по проекта с целия екип и после подготовка";
    const ics = buildIcs({ ...BASE, title: long });
    const encoder = new TextEncoder();
    for (const line of lines(ics)) {
      assert.ok(
        encoder.encode(line).length <= 75,
        `line over 75 bytes: ${line}`,
      );
    }
  });

  test("continuation lines begin with a space", () => {
    const ics = buildIcs({ ...BASE, title: "x".repeat(200) });
    const folded = lines(ics).filter(l => l.startsWith(" "));
    assert.ok(folded.length > 0, "expected at least one folded continuation");
  });

  test("shortens a very long title for the summary but keeps it in full", () => {
    const long = "A".repeat(120);
    const ics = buildIcs({ ...BASE, title: long });
    assert.ok(ics.includes("…"), "expected the summary to be trimmed");
    assert.ok(ics.includes("DESCRIPTION:"), "expected the full title kept");
  });
});

describe("googleCalendarUrl", () => {
  test("points at Google's event template", () => {
    const url = new URL(googleCalendarUrl(BASE));
    assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
    assert.equal(url.searchParams.get("action"), "TEMPLATE");
  });

  test("carries the task as the event title", () => {
    const url = new URL(googleCalendarUrl(BASE));
    assert.equal(url.searchParams.get("text"), "Feedback session with Petya");
  });

  test("writes the range in Google's compact UTC form", () => {
    const url = new URL(googleCalendarUrl(BASE));
    assert.equal(url.searchParams.get("dates"), "20260820T182000Z/20260820T192000Z");
  });

  test("honours an explicit duration", () => {
    const url = new URL(googleCalendarUrl({ ...BASE, durationMinutes: 30 }));
    assert.equal(url.searchParams.get("dates"), "20260820T182000Z/20260820T185000Z");
  });

  test("escapes characters that would otherwise break the query", () => {
    // A task containing & or = would truncate or corrupt the parameters.
    const url = new URL(googleCalendarUrl({ ...BASE, title: "Tea & biscuits = good" }));
    assert.equal(url.searchParams.get("text"), "Tea & biscuits = good");
  });

  test("survives a Cyrillic title", () => {
    const title = "Обратна връзка с Петя";
    const url = new URL(googleCalendarUrl({ ...BASE, title }));
    assert.equal(url.searchParams.get("text"), title);
  });

  test("trims a title too long for a URL", () => {
    const url = new URL(googleCalendarUrl({ ...BASE, title: "A".repeat(500) }));
    assert.equal((url.searchParams.get("text") ?? "").length, 200);
  });
});
