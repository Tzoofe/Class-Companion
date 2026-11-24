import { describe, expect, it } from 'vitest';
import { aggregate, readPollInput, readResponse } from '../src/lib/polls';

describe('readPollInput', () => {
  it('builds choice options with ids and maps correct indexes', () => {
    const p = readPollInput({ question: ' 2+2? ', type: 'choice', options: ['3', '4', '5'], correct: [1] });
    expect(p).toMatchObject({ question: '2+2?', multiple: false, audience: 'roster', correctOptionIds: ['o2'] });
    expect('options' in p && p.options).toEqual([
      { id: 'o1', text: '3' },
      { id: 'o2', text: '4' },
      { id: 'o3', text: '5' },
    ]);
  });

  it('yes/no gets fixed options; scale and text get none', () => {
    expect(readPollInput({ question: 'q', type: 'yesno', correct: ['yes'] })).toMatchObject({ options: [{ id: 'yes' }, { id: 'no' }], correctOptionIds: ['yes'] });
    expect(readPollInput({ question: 'q', type: 'scale', options: ['x'] })).toMatchObject({ options: [], multiple: false });
    expect(readPollInput({ question: 'q', type: 'text', showTextOnScreen: false })).toMatchObject({ showTextOnScreen: false });
  });

  it('rejects bad input', () => {
    const err = (b: object) => (readPollInput(b) as { error?: string }).error;
    expect(err({ type: 'choice' })).toBe('Question is required');
    expect(err({ question: 'q', type: 'quiz' })).toBe('Invalid poll type');
    expect(err({ question: 'q', type: 'choice', options: ['only'] })).toBe('A poll needs 2–6 options');
    expect(err({ question: 'q', type: 'choice', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toBe('A poll needs 2–6 options');
    expect(err({ question: 'q', type: 'choice', options: ['a', ' '] })).toBe('Options cannot be empty');
    expect(err({ question: 'q', type: 'choice', options: ['a', 'a'] })).toBe('Options must be different');
    expect(err({ question: 'q', type: 'choice', options: ['a', 'b'], correct: [0, 1] })).toBe('Invalid correct answer'); // single choice
    expect(err({ question: 'q', type: 'choice', options: ['a', 'b'], correct: [5] })).toBe('Invalid correct answer');
    expect(err({ question: 'q', type: 'scale', correct: [0] })).toBe('Invalid correct answer');
    expect(err({ question: 'q', type: 'text', audience: 'everyone' })).toBe('Invalid audience');
    expect(readPollInput({ question: 'q', type: 'choice', options: ['a', 'b'], multiple: true, correct: [0, 1] })).toMatchObject({ correctOptionIds: ['o1', 'o2'] });
  });
});

describe('readResponse', () => {
  const single = { type: 'choice', multiple: false, options: [{ id: 'o1' }, { id: 'o2' }] };
  it('validates option answers', () => {
    expect(readResponse(single, { optionIds: ['o2'] })).toEqual({ optionIds: ['o2'] });
    expect(readResponse(single, { optionIds: ['o1', 'o2'] })).toEqual({ error: 'Choose one answer' });
    expect(readResponse({ ...single, multiple: true }, { optionIds: ['o1', 'o2', 'o1'] })).toEqual({ optionIds: ['o1', 'o2'] });
    expect(readResponse(single, { optionIds: ['x'] })).toEqual({ error: 'Invalid answer' });
    expect(readResponse(single, { optionIds: [] })).toEqual({ error: 'Invalid answer' });
  });
  it('validates scale and text answers', () => {
    const scale = { type: 'scale', multiple: false, options: [] };
    expect(readResponse(scale, { value: 5 })).toEqual({ value: 5 });
    expect(readResponse(scale, { value: 6 })).toEqual({ error: 'Invalid answer' });
    expect(readResponse(scale, { value: 2.5 })).toEqual({ error: 'Invalid answer' });
    const text = { type: 'text', multiple: false, options: [] };
    expect(readResponse(text, { text: '  רקורסיה ' })).toEqual({ text: 'רקורסיה' });
    expect(readResponse(text, { text: 'x'.repeat(201) })).toEqual({ error: 'Answer is too long' });
  });
});

describe('aggregate', () => {
  it('counts options, scale values (with average) and collects texts', () => {
    const choice = { type: 'choice', options: [{ id: 'o1' }, { id: 'o2' }] };
    expect(aggregate(choice, [{ optionIds: ['o1'] }, { optionIds: ['o1', 'o2'] }])).toEqual({ responses: 2, counts: { o1: 2, o2: 1 } });
    expect(aggregate({ type: 'scale', options: [] }, [{ value: 4 }, { value: 5 }, { value: 5 }])).toEqual({ responses: 3, scale: { counts: [0, 0, 0, 1, 2], average: 4.7 } });
    expect(aggregate({ type: 'scale', options: [] }, [])).toEqual({ responses: 0, scale: { counts: [0, 0, 0, 0, 0], average: null } });
    expect(aggregate({ type: 'text', options: [] }, [{ text: 'a' }, { text: 'b' }])).toEqual({ responses: 2, texts: ['a', 'b'] });
  });
});
