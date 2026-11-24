import { config } from '../../config.js';

/** Asks a language model for JSON matching `schema`. Swappable (tests use a fake). */
export type LlmClient = (req: { system: string; user: string; schema: object; model?: string }) => Promise<unknown>;

/** Local model through Ollama (runs on this Mac, no internet needed). */
export const ollamaClient: LlmClient = async ({ system, user, schema, model }) => {
  const res = await fetch(`${config.ollama.url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model ?? config.ollama.model,
      stream: false,
      format: schema, // Ollama constrains the output to this JSON schema
      options: { temperature: 0.2, num_ctx: config.ollama.contextTokens },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Local model error (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { message?: { content?: string } };
  try {
    return JSON.parse(data.message?.content ?? '');
  } catch {
    throw new Error('Local model returned invalid JSON');
  }
};
