/**
 * Composes a due timestamp from a date and an optional time.
 *
 * The model used to be asked for a full ISO instant, and it got it wrong in a
 * way that only showed up in use: "до 25 септември" came back as a timestamp
 * that rendered as 26 September at 00:59, and a task with no stated time became
 * an event at midnight. Both are the same failure — asking a language model to
 * do timezone arithmetic, which it is bad at and has no need to do.
 *
 * So it now reports what it heard: a calendar date, and a clock time only when
 * the person actually said one. The arithmetic happens here, where it can be
 * tested.
 */

/** When a date is given with no time of day. Morning, not midnight. */
export const DEFAULT_HOUR = 9;

export interface SpokenDue {
  /** YYYY-MM-DD, as the speaker would write it. */
  date: string;
  /** HH:MM in their local clock, or null when no time was stated. */
  time?: string | null;
}

/**
 * Turn a local date and time into an instant.
 *
 * @param offsetMinutes  The user's offset from UTC, as `getTimezoneOffset()`
 *   reports it — positive west of Greenwich. Sofia in summer is -180.
 */
export function composeDue(
  due: SpokenDue,
  offsetMinutes: number,
  now: Date = new Date(),
): Date | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due.date?.trim() ?? "");
  if (!date) return null;

  const [, yearText, monthText, dayText] = date;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  // Reject impossible dates before they become a real but wrong instant:
  // Date.UTC rolls 2026-02-31 forward into March without complaint.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let hour = DEFAULT_HOUR;
  let minute = 0;

  if (due.time) {
    const time = /^(\d{1,2}):(\d{2})$/.exec(due.time.trim());
    if (!time) return null;
    hour = Number(time[1]);
    minute = Number(time[2]);
    if (hour > 23 || minute > 59) return null;
  }

  // Checked before the offset is applied, not after. Date.UTC rolls 31 February
  // forward into March without complaining, and once the offset has shifted the
  // instant across midnight the UTC date legitimately differs from the one that
  // was said — so comparing afterwards rejects every late-evening time.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;

  // The wall-clock moment the person meant, shifted by their offset to get the
  // instant it happens.
  const composed = new Date(Date.UTC(year, month - 1, day, hour, minute) + offsetMinutes * 60_000);

  // More than a day in the past is a misheard date, not a deadline. A reminder
  // for a moment that has gone is worse than none.
  if (composed.getTime() < now.getTime() - 24 * 60 * 60 * 1000) return null;

  // Two years out is a misread year, not a plan.
  if (composed.getTime() > now.getTime() + 730 * 24 * 60 * 60 * 1000) return null;

  return composed;
}
