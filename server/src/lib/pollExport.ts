import type mongoose from 'mongoose';
import { Poll, PollResponse } from '../models/Poll.js';
import type { ExportPoll } from './export.js';
import { aggregate } from './polls.js';

/** Opened polls of a course in export form: a results line and each student's answer. */
export async function exportPolls(courseId: mongoose.Types.ObjectId): Promise<ExportPoll[]> {
  const polls = await Poll.find({ courseId, status: { $ne: 'draft' } }).sort({ openedAt: 1 });
  const responses = await PollResponse.find({ pollId: { $in: polls.map((p) => p._id) } }).sort({ email: 1 });
  return polls.map((p) => {
    const rs = responses.filter((r) => String(r.pollId) === String(p._id));
    const answers = rs.map((r) => ({ optionIds: r.optionIds ?? undefined, value: r.value ?? undefined, text: r.text ?? undefined }));
    const results = aggregate(p, answers);
    const optionText = new Map(p.options.map((o) => [o.id, o.text]));
    const correct = new Set(p.correctOptionIds);
    let summary = '';
    if (results.counts) summary = p.options.map((o) => `${o.text}: ${results.counts![o.id]}${correct.has(o.id) ? ' ✓' : ''}`).join('\n');
    else if (results.scale) summary = `ממוצע ${results.scale.average ?? '—'} · ${results.scale.counts.map((c, i) => `${i + 1}: ${c}`).join(' · ')}`;
    else summary = `${results.texts?.length ?? 0} תשובות טקסט`;
    return {
      openedAt: p.openedAt ?? null,
      question: p.question,
      type: p.type,
      summary,
      responses: rs.length,
      answers: rs.map((r) => {
        const ids = r.optionIds ?? [];
        const answer = ids.length ? ids.map((id) => optionText.get(id) ?? id).join(', ') : typeof r.value === 'number' ? String(r.value) : (r.text ?? '');
        const isCorrect = correct.size && ids.length ? ids.length === correct.size && ids.every((id) => correct.has(id)) : null;
        return { email: r.email, answer, correct: isCorrect };
      }),
    };
  });
}
