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
  /** Used as the event title. */
  title: string;
  start: Date;
  /** Defaults to one hour, which is a reasonable guess for a diary task. */
  durationMinutes?: number;
  /** A stable id, so re-adding the same task updates rather than duplicates. */
  uid: string;
}

export function buildIcs(event: CalendarEvent): string {
  const end = new Date(event.start.getTime() + (event.durationMinutes ?? 60) * 60_000);

  // A title long enough to be its own paragraph makes a useless calendar entry,
  // so it is trimmed for the summary and kept whole in the description.
  const summary = event.title.length > 70
    ? `${event.title.slice(0, 67).trimEnd()}…`
    : event.title;

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
    text: event.title.slice(0, 200),
    dates: `${stamp(event.start)}/${stamp(end)}`,
    details: "Added from One for All",
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
