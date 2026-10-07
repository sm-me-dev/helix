// Real token counting for the harness pack.
//
// Method: o200k_base byte-pair encoding via gpt-tokenizer (OpenAI GPT-4o/GPT-5
// class tokenizer). This is an APPROXIMATION of whatever model actually serves
// the agent — Claude, Gemini, and GPT tokenizers disagree by ~10-20% on code
// and prose. Every number derived from countTokens must be presented with
// TOKENIZER_METHOD beside it, never as the target model's own count.
import { encode } from "gpt-tokenizer";

export const TOKENIZER_METHOD =
  "o200k_base BPE via gpt-tokenizer (approximation of frontier tokenizers, not the serving model's own count)";

export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}
