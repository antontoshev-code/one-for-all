export function categorizeContent(text: string): 'journal' | 'task' | 'idea' | 'log' {
  const t = text.toLowerCase();
  
  const taskWords = ["need to", "remind", "todo", "must", "should", "don't forget", "remember to", "have to", "call", "email", "schedule"];
  if (taskWords.some(w => t.includes(w))) return 'task';
  
  const ideaWords = ["idea", "what if", "concept", "maybe we could", "what about", "thinking about building", "could be interesting"];
  if (ideaWords.some(w => t.includes(w))) return 'idea';
  
  const logWords = ["did", "went", "finished", "completed", "ran", "worked out", "workout", "ate", "cooked", "watched", "read"];
  if (logWords.some(w => t.includes(w))) return 'log';
  
  return 'journal';
}

const templates = [
  "Today I went to the store and picked up a few things.",
  "I've been thinking about starting a new project lately.",
  "Need to follow up with Sarah about the meeting next week.",
  "Had a really good workout this morning — felt great.",
  "Got a new idea for the app I've been building.",
  "Finished reading that book I started last month.",
  "Reminder to call mom this weekend.",
  "The weather has been amazing lately, spent time outside.",
  "Thinking about what I want to do differently going forward."
];

export function getMockTranscript(): string {
  const count = Math.floor(Math.random() * 2) + 2;
  const selected = [];
  const pool = [...templates];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return selected.join(" ");
}
