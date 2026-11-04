// src/registry/model-kind.ts — what a model is for. Shared by storage, models.dev lookup and the UI.

export type ModelKind = 'chat' | 'embedding' | 'reranking' | 'classifier' | 'image' | 'video' | 'audio';

export const MODEL_KINDS: readonly ModelKind[] = ['chat', 'embedding', 'reranking', 'classifier', 'image', 'video', 'audio'];

// Order matters: specific purposes first, so "granite-embedding" or "qwen3-reranker" never fall to a chat family.
const NAME_RULES: ReadonlyArray<readonly [RegExp, ModelKind | null]> = [
  [/rerank/, 'reranking'],
  [/embed|(?:^|[^a-z])(?:bge|gte)(?:[^a-z]|$)/, 'embedding'],
  [/guard|moderation|shield/, 'classifier'],
  [/whisper|speech|transcri|(?:^|[^a-z])tts(?:[^a-z]|$)/, 'audio'],
  [/dall-?e|imagen|flux|stable-diffusion|sdxl|gpt-image|-image(?:-|$)/, 'image'],
  [/(?:^|[^a-z])(?:sora|veo)(?:[^a-z]|$)/, 'video'],
  // Document parsers take chat requests but are not chat models; leave them unknown.
  [/parse|ocr/, null],
  [/instruct|chat|thinking|coder|(?:^|[^a-z])it(?:[^a-z]|$)/, 'chat'],
  [/gpt|claude|gemini|llama|qwen|mistral|mixtral|ministral|devstral|codestral|magistral|deepseek|glm|granite|gemma|nemotron|kimi|grok|phi|minimax|olmo|hermes/, 'chat'],
];

/** Best guess from the model id alone; undefined when the name says nothing. A display hint, not a fact. */
export function guessModelKindFromName(modelId: string): ModelKind | undefined {
  const name = modelId.toLowerCase();
  for (const [pattern, kind] of NAME_RULES) {
    if (pattern.test(name)) return kind ?? undefined;
  }
  return undefined;
}

/** Name-guessed kinds that still reply to a chat request (safety, media); the name wins over a passing Test. */
export function nameKindOutranksChatTest(kind: ModelKind | undefined): boolean {
  return kind === 'classifier' || kind === 'image' || kind === 'video' || kind === 'audio';
}
