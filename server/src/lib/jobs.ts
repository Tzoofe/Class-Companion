/**
 * One background queue for all heavy local work (transcription, lesson summaries, homework reviews):
 * they each use most of the machine, so they run one at a time.
 */
let chain: Promise<void> = Promise.resolve();

export function enqueueJob(name: string, job: () => Promise<void>) {
  chain = chain.then(job).catch((e) => console.error(`${name} failed`, e));
  return chain;
}

/** Resolves when every job queued so far has finished (tests). */
export const settleJobs = () => chain;
