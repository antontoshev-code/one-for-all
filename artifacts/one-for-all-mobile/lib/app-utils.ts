import type { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type Category = 'journal' | 'task' | 'idea' | 'log';

type FeatherName = ComponentProps<typeof Feather>['name'];

export const CATEGORIES: {
  key: Category;
  title: string;
  subtitle: string;
  icon: FeatherName;
}[] = [
  { key: 'journal', title: 'Journal', subtitle: 'thoughts & reflections', icon: 'book-open' },
  { key: 'task', title: 'Tasks', subtitle: 'something to do', icon: 'check-square' },
  { key: 'idea', title: 'Ideas', subtitle: 'a concept to explore', icon: 'zap' },
  { key: 'log', title: 'Log', subtitle: 'body, health & workouts', icon: 'activity' },
];

export const CATEGORY_META = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c]),
) as unknown as Record<Category, { title: string; subtitle: string; icon: FeatherName }>;

/** Absolute URL to the shared API server (Expo runs outside the web proxy). */
export function apiUrl(path: string): string {
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}${path}`;
}

const MOCK_TEMPLATES = [
  'Need to call the dentist tomorrow to reschedule my appointment.',
  'Had a really good conversation with Anna about the new project direction.',
  'What if the app could group similar thoughts automatically?',
  'Went for a 5k run this morning, legs felt strong.',
  'Feeling a bit overwhelmed with everything going on this week.',
  'Idea: a shared grocery list that sorts items by aisle.',
  "Don't forget to water the plants before the weekend trip.",
  'Finished reading that book Marco recommended — really worth it.',
];

export function getMockTranscript(): string {
  const count = Math.floor(Math.random() * 2) + 2;
  const pool = [...MOCK_TEMPLATES];
  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return selected.join(' ');
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + `, ${time}`;
}
