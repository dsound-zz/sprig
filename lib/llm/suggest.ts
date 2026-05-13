/**
 * lib/llm/suggest.ts
 * Phase 2: Together AI integration for mind map child node suggestions.
 *
 * Model: meta-llama/Meta-Llama-3-8B-Instruct-Lite
 * Uses Together AI's serverless inference — confirmed available via /v1/models.
 */

export const TOGETHER_AI_URL = "https://api.together.xyz/v1/chat/completions";
// Confirmed serverless on this account ($0.10/M tokens, fast)
export const MODEL = "meta-llama/Meta-Llama-3-8B-Instruct-Lite";
const MAX_LABEL_LENGTH = 15;
const SUGGESTION_COUNT = 3;

const FALLBACK: string[] = ["", "", ""];

/**
 * Given a concept and a list of labels already on the map,
 * call Together AI and return exactly 3 suggested child node labels.
 * Each label is validated to be ≤15 chars (truncated if needed).
 * On any error, returns 3 empty strings — never throws.
 */
export async function suggestChildLabels(
  concept: string,
  existingLabels: string[]
): Promise<string[]> {
  const apiKey = process.env.TOGETHER_AI;
  if (!apiKey) {
    console.error("[suggest] TOGETHER_AI env var is undefined at runtime");
    return FALLBACK;
  }

  const prompt = `You are a mind map assistant. Given a concept, suggest 3 closely related concepts for child nodes.
Rules:
- Each label must be 15 characters or fewer
- Single words strongly preferred; two words only if essential
- No repetition of existing labels: ${existingLabels.join(", ")}
- Return ONLY valid JSON, no markdown, no explanation
Format: { "suggestions": ["word1", "word2", "word3"] }

Concept: "${concept}"`;

  try {
    const response = await fetch(TOGETHER_AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 100,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const rawErrorText = await response.text();
      console.error(
        "[suggest] Together AI HTTP error",
        response.status,
        response.statusText,
        "— body:",
        rawErrorText
      );
      return FALLBACK;
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    // Together AI response shape: choices[0].message.content
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      console.error("[suggest] Unexpected response shape — content missing:", JSON.stringify(json));
      return FALLBACK;
    }

    // Strip markdown code fences (opening AND closing) the model may add
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("[suggest] Could not parse LLM JSON — cleaned string was:", cleaned);
      return FALLBACK;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>).suggestions)
    ) {
      console.error("[suggest] Malformed suggestion object:", JSON.stringify(parsed));
      return FALLBACK;
    }

    const rawSuggestions = (parsed as { suggestions: unknown[] }).suggestions;

    // Validate and truncate to MAX_LABEL_LENGTH; pad with "" if fewer than 3
    const suggestions: string[] = Array.from({ length: SUGGESTION_COUNT }, (_, i) => {
      const raw = rawSuggestions[i];
      if (typeof raw !== "string") return "";
      return raw.trim().slice(0, MAX_LABEL_LENGTH);
    });

    return suggestions;
  } catch (err) {
    console.error("[suggest] Unexpected error:", err);
    return FALLBACK;
  }
}
