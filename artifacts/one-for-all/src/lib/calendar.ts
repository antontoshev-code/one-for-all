/**
 * Builds an .ics file for a task with a due date.
 *
 * Reminders are delegated to the user's own calendar rather than implemented in
 * the app. A browser notification only fires while the page is open, so a
 * reminder for a 21:20 meeting would arrive if and only if the person happened
 * to be looking at their diary app at 21:20 — precisely when they are not. The
 * phone's calendar already solves this, has the user's notification preferences
 * and works with the screen off.
 *
 * It also means a task can be shared, moved or invited to, which nothing built
 * inside this app would allow.
 */

/** iCalendar wants UTC as YYYYMMDDTHHMMSSZ, with no punctuation. */
function icsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Escape the characters iCalendar treats as structure.
 *
 * Order matters: backslashes first, or the escapes added afterwards get escaped
 * in turn and the file arrives full of stray slashes.
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold long lines at 75 octets, as the spec requires.
 *
 * Counted in bytes rather than characters, because Cyrillic takes two bytes
 * apiece — a Bulgarian task measured in characters produces lines that are
 * technically too long, and strict parsers reject the file.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let bytes = 0;

  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines start with a space, which costs one of the 75.
    if (bytes + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }

  if (current) parts.push(current);
  return parts.join("\r\n ");
}

export interface CalendarEvent {
  /** The full thought. Shortened for the title, kept whole in the description. */
  title: string;
  start: Date;
  /** Defaults to one hour, which is a reasonable guess for a diary task. */
  durationMinutes?: number;
  /** A stable id, so re-adding the same task updates rather than duplicates. */
  uid: string;
}

export function buildIcs(event: CalendarEvent): string {
  const end = new Date(event.start.getTime() + (event.durationMinutes ?? 60) * 60_000);

  // A paragraph makes a useless calendar entry, so the summary is the short
  // form and the description keeps every word.
  const summary = calendarTitleFor(event.title);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//One for All//Task//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    // DTSTAMP is when the file was written; DTSTART is when the thing happens.
    `DTSTAMP:${icsTimestamp(new Date())}`,
    `DTSTART:${icsTimestamp(event.start)}`,
    `DTEND:${icsTimestamp(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(event.title)}`,
    "BEGIN:VALARM",
    // Ten minutes is enough to walk to a thing without being nagged early.
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(summary)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // CRLF throughout — the spec says so, and some calendar apps do reject LF.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Hand the .ics to the browser, which passes it to the calendar app. */
export function downloadIcs(event: CalendarEvent): void {
  const blob = new Blob([buildIcs(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.slice(0, 40).replace(/[^\p{L}\p{N} -]/gu, "").trim() || "task"}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * A Google Calendar "create event" link.
 *
 * The .ics download works everywhere but is a poor experience on a phone: the
 * file lands in Downloads and the person has to find it and decide what opens
 * it. A link goes straight to a pre-filled event they confirm in one tap.
 *
 * This is deliberately a link and not the Google Calendar API. The API would
 * mean asking every user for permission to read and write their whole calendar,
 * storing a refresh token, and holding a scope that could read every meeting
 * they have — a serious amount of access for an app whose promise is that it
 * keeps to itself. The link needs no permission at all, and the event is only
 * created if they press save.
 */
export function googleCalendarUrl(event: CalendarEvent): string {
  const end = new Date(event.start.getTime() + (event.durationMinutes ?? 60) * 60_000);

  // Google wants the same compact UTC form as iCalendar, joined by a slash.
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: calendarTitleFor(event.title),
    dates: `${stamp(event.start)}/${stamp(end)}`,
    // The thought as it was captured, labelled, so the calendar entry says
    // where it came from and the short title never loses the detail.
    details: `${event.title}

Captured in One for All`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * A short, scannable title for a calendar entry.
 *
 * The whole thought was being used as the event name, which in a week view is
 * a wall of text truncated mid-sentence. Google keeps summary and description
 * apart for exactly this reason: the title is what you scan, the description is
 * where the detail lives.
 *
 * Built from the person's own words rather than generated. A title they did not
 * write, appearing in their calendar next to real appointments, is a small lie
 * about what they said — and the leading obligation phrase is the part carrying
 * no information anyway, since everything here is something they need to do.
 */
export function calendarTitleFor(text: string): string {
  let title = text.trim();

  // Openings that say when, or that say "this is a task" — both true of
  // everything here, so both cost characters and carry no information.
  // Applied repeatedly, because they stack: "По някое време, утре, може би към
  // 11.00 е хубаво да проверя маслото" opens with three of them in a row.
  const NOISE = [
    /^(?:утре|днес|довечера|тази вечер|тази сутрин|тази седмица)[,\s]+/iu,
    /^(?:утре|днес|довечера|тази вечер|тази сутрин)?\s*(?:трябва|искам|имам задача)\s+да\s*/iu,
    /^(?:за утре|за днес|за довечера)\s*/iu,
    /^(?:по\s+н[яе]ко[еи]\s+време|някъде\s+към|някъде\s+около)[,\s]*/iu,
    /^(?:може\s+би|евентуално|примерно|горе-долу|около|към)\s+/iu,
    /^(?:и\s+)?(?:също\s+така|между\s+другото)[,\s]*/iu,
    /^(?:i\s+)?(?:need|have|want|ought)\s+to\s*/iu,
    /^(?:remember|remind me)\s+to\s*/iu,
    /^(?:tomorrow|today|tonight|this evening|this morning)[,\s]+/iu,
    /^(?:at\s+)?some\s+point[,\s]*/iu,
    /^(?:maybe|possibly|roughly|around|about|sometime)[,\s]+/iu,
    // A bare clock time left at the front once its "around" has gone.
    /^\d{1,2}[:.]\d{2}\s*(?:ч(?:аса)?|h|am|pm)?[,\s]+/iu,
    /^(?:в|at)\s+\d{1,2}[:.]\d{2}[,\s]+/iu,
  ];

  for (let pass = 0; pass < 4; pass++) {
    const before = title;
    for (const phrase of NOISE) title = title.replace(phrase, "");
    if (title === before) break;
  }

  /** A clause that is only a time reference tells you nothing about the task. */
  const isJustTime = (phrase: string) =>
    /^(?:[\d:.\s]|ч|часа?|мин|утре|днес|довечера|сутринта|вечерта|am|pm|o'clock|tomorrow|today|tonight|morning|evening)+$/iu
      .test(phrase.trim());

  // The first clause usually carries the action — but only take it if it says
  // something, and if enough is left to read as a phrase.
  const clause = title.split(/[,;.!?—]/)[0].trim();
  if (clause.split(/\s+/).filter(Boolean).length >= 3 && !isJustTime(clause)) title = clause;

  // Trim at a word boundary rather than mid-word.
  const LIMIT = 60;
  if (title.length > LIMIT) {
    const cut = title.slice(0, LIMIT);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
  }

  title = title.trim();
  if (!title) return "Task";

  return title.charAt(0).toLocaleUpperCase() + title.slice(1);
}
