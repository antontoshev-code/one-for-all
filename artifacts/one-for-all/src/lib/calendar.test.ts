import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, googleCalendarUrl, calendarTitleFor } from "./calendar.ts";

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

  test("keeps the title short enough to scan", () => {
    // Superseded: the title is now the short form rather than the whole
    // thought, so it is bounded by the title rule and not by URL length.
    const url = new URL(googleCalendarUrl({ ...BASE, title: "A".repeat(500) }));
    assert.ok((url.searchParams.get("text") ?? "").length <= 61);
  });
});

describe("calendarTitleFor", () => {
  test("shortens a whole thought to a scannable title", () => {
    // This was the event name in full: unusable in a week view, truncated
    // mid-sentence by the calendar itself.
    const thought = "Утре трябва да стана в примерно 8 часа или 8:30, и съответно да видя " +
      "какво мога да направя, така че да тръгнем по възможно най-добрия начин, " +
      "най-навреме и да стигнем до Трън примерно към 12 часа.";
    const title = calendarTitleFor(thought);
    assert.ok(title.length <= 61, `too long: ${title}`);
    assert.equal(title.includes("Трън примерно към 12"), false, "kept the whole thought");
  });

  test("drops a leading obligation phrase", () => {
    // True of every task here, so it costs characters and says nothing.
    assert.equal(calendarTitleFor("I need to prepare the tea before we leave"),
      "Prepare the tea before we leave");
    assert.equal(calendarTitleFor("трябва да подготвя плановете за пътуване"),
      "Подготвя плановете за пътуване");
  });

  test("drops a leading day word", () => {
    assert.equal(calendarTitleFor("Tomorrow, call the dentist about the appointment"),
      "Call the dentist about the appointment");
  });

  test("keeps a short task exactly as written", () => {
    assert.equal(calendarTitleFor("Пусни пералня"), "Пусни пералня");
  });

  test("cuts at the first clause when enough remains", () => {
    assert.equal(
      calendarTitleFor("Send the photos to my aunt, then call her back later"),
      "Send the photos to my aunt",
    );
  });

  test("does not cut to a single stray word", () => {
    // "Call, then wait" would otherwise become "Call".
    const title = calendarTitleFor("Call, then wait for the delivery to arrive");
    assert.ok(title.split(/\s+/).length > 1, `too short: ${title}`);
  });

  test("trims at a word boundary, not mid-word", () => {
    const title = calendarTitleFor("A".repeat(20) + " " + "B".repeat(80));
    assert.equal(/[A-Z]…$/.test(title) && title.includes("BBB"), false);
  });

  test("capitalises the result", () => {
    assert.match(calendarTitleFor("подготвя нещата за утре"), /^П/);
  });

  test("never returns an empty title", () => {
    assert.equal(calendarTitleFor("   "), "Task");
    assert.equal(calendarTitleFor("I need to "), "Task");
  });

  test("the full thought is kept in the calendar entry", () => {
    const thought = "Утре трябва да стана в 8 часа и да стигнем до Трън към 12";
    const ics = buildIcs({ ...BASE, title: thought });
    assert.ok(ics.includes("SUMMARY:"), "expected a short summary");
    // Folding splits long lines, so check a distinctive fragment survives.
    assert.ok(ics.replace(/\r\n /g, "").includes("Трън"), "lost the detail");

    const url = new URL(googleCalendarUrl({ ...BASE, title: thought }));
    assert.ok((url.searchParams.get("details") ?? "").includes("Трън"));
    assert.ok((url.searchParams.get("text") ?? "").length < thought.length);
  });
});
