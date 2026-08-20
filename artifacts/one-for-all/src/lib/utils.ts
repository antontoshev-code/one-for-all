import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/**
 * A due time written the way someone would say it.
 *
 * "Today at 21:20" is what the person dictating actually meant; "20/08/2026,
 * 21:20" is what a machine would say back. Only dates far enough away to be
 * ambiguous get spelled out in full.
 */
export function formatDueDate(due: Date): string {
  const time = due.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(due) - startOfDay(new Date())) / 86_400_000);

  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Tomorrow at ${time}`;
  if (days === -1) return `Yesterday at ${time}`;
  if (days > 1 && days < 7) {
    return `${due.toLocaleDateString(undefined, { weekday: "long" })} at ${time}`;
  }

  return `${due.toLocaleDateString(undefined, { day: "numeric", month: "short" })} at ${time}`;
}
