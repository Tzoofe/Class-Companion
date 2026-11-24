import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../src/lib/summaries/llm';
import { summarizeLesson } from '../src/lib/summaries/summarize';

const ctx = { courseName: 'מבוא', questions: ['למה צריך מקרה בסיס?'], polls: [{ question: 'הבנתם?', result: '60% ענו לא' }] };

describe('summarizeLesson', () => {
  it('summarizes per chunk, keeps transcript times, merges and dedupes', async () => {
    const prompts: string[] = [];
    const llm: LlmClient = async ({ user }) => {
      prompts.push(user);
      if (user.includes('תמלול:')) {
        const n = prompts.length;
        return {
          topics: [{ title: `נושא ${n}`, points: ['נקודה', ' ', 7] }],
          concepts: [{ term: 'רקורסיה', definition: 'פונקציה שקוראת לעצמה' }],
          reminders: n === 1 ? ['זה יופיע במבחן'] : ['זה יופיע במבחן', 'תרגיל 3'],
        };
      }
      return { overview: ' סקירה ', confusion: ['א', 'ב', 'ג', 'ד', 'ה'], reviewQuestions: ['ש1'] };
    };
    const segments = Array.from({ length: 4 }, (_, i) => ({ start: i * 600, end: i * 600 + 600, text: 'מילה '.repeat(800) }));
    const progress: number[] = [];
    const s = await summarizeLesson(segments, ctx, llm, (d, t) => progress.push(Math.round((d / t) * 100)));

    expect(prompts.filter((p) => p.includes('תמלול:')).length).toBe(4); // one per ~6000 chars
    expect(prompts.at(-1)).toContain('למה צריך מקרה בסיס?');
    expect(prompts.at(-1)).toContain('60% ענו לא');
    expect(s.topics.map((t) => [t.at, t.title])).toEqual([[0, 'נושא 1'], [600, 'נושא 2'], [1200, 'נושא 3'], [1800, 'נושא 4']]);
    expect(s.topics[0].points).toEqual(['נקודה']);
    expect(s.concepts).toHaveLength(1);
    expect(s.reminders).toEqual(['זה יופיע במבחן', 'תרגיל 3']);
    expect(s.overview).toBe('סקירה');
    expect(s.confusion).toHaveLength(4);
    expect(progress.at(-1)).toBe(100);
  });

  it('uses no timestamps for plain-text transcripts and rejects an empty transcript', async () => {
    const llm: LlmClient = async ({ user }) => (user.includes('תמלול:') ? { topics: [{ title: 'נושא', points: [] }], concepts: [], reminders: [] } : { overview: 'x', confusion: [], reviewQuestions: [] });
    const s = await summarizeLesson([{ start: 0, end: 0, text: 'טקסט' }], ctx, llm);
    expect(s.topics[0].at).toBeNull();
    await expect(summarizeLesson([], ctx, llm)).rejects.toThrow('The transcript is empty');
  });
});
