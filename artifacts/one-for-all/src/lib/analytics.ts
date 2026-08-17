/**
 * Founder-facing event log — no external tracking, just console + in-memory.
 * Access the event history from browser console: window.__ofa_events
 */

export type EventType =
  | "capture_created"
  | "suggestion_accepted"
  | "suggestion_rejected"
  | "capture_split"
  | "entry_deleted"
  | "export_requested"
  | "data_cleared";

interface OFAEvent {
  type: EventType;
  ts: string;
  data?: Record<string, unknown>;
}

declare global {
  interface Window {
    __ofa_events: OFAEvent[];
  }
}

if (typeof window !== "undefined" && !window.__ofa_events) {
  window.__ofa_events = [];
}

export function logEvent(type: EventType, data?: Record<string, unknown>): void {
  const event: OFAEvent = { type, ts: new Date().toISOString(), ...(data ? { data } : {}) };
  if (typeof window !== "undefined") {
    window.__ofa_events.push(event);
  }
  console.log(`[OFA] ${type}`, data ?? "");
}
