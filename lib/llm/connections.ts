import { MODEL, TOGETHER_AI_URL } from "./suggest";

const MAX_CONNECTIONS = 8;
const MAX_REASON_LENGTH = 40;

export type ConnectionPair = {
  sourceId: string;
  targetId: string;
  reason: string;
};

type NodeInput = {
  id: string;
  label: string;
  parentId: string | null;
};

/**
 * Given map nodes, ask the LLM to identify cross-branch relationships.
 * Filters out the root node (parentId null) before sending.
 * Uses short indices (n0, n1, ...) in the prompt instead of UUIDs so the
 * small model doesn't mangle them, then maps back to real IDs after parsing.
 * Deduplicates (A→B) and (B→A). Caps at 8 pairs.
 * Returns empty array on any failure — never throws.
 */
export async function findConnections(nodes: NodeInput[]): Promise<ConnectionPair[]> {
  const apiKey = process.env.TOGETHER_AI;
  if (!apiKey) {
    console.error("[connections] TOGETHER_AI env var is undefined at runtime");
    return [];
  }

  const nonRootNodes = nodes.filter((n) => n.parentId !== null);
  if (nonRootNodes.length < 2) return [];

  // Build short-ID maps so the LLM works with n0/n1/... instead of UUIDs
  const shortId = (i: number) => `n${i}`;
  const realToShort = new Map(nonRootNodes.map((n, i) => [n.id, shortId(i)]));
  const shortToReal = new Map(nonRootNodes.map((n, i) => [shortId(i), n.id]));

  const nodeLines = nonRootNodes.map((n, i) => {
    const parent = n.parentId ? (realToShort.get(n.parentId) ?? "root") : "root";
    return `${shortId(i)}: "${n.label}", parent: ${parent}`;
  });

  const prompt = `You are analyzing a mind map. Identify pairs of nodes from DIFFERENT branches that are meaningfully related to each other.

Nodes:
${nodeLines.join("\n")}

Rules:
- Pair nodes from different top-level branches only
- Maximum 8 pairs
- Each reason must be 40 characters or fewer
- Return ONLY valid JSON, no markdown
Format: { "connections": [{ "sourceId": "n0", "targetId": "n3", "reason": "..." }] }`;

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
        max_tokens: 400,
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      const rawErrorText = await response.text();
      console.error(
        "[connections] Together AI HTTP error",
        response.status,
        response.statusText,
        "— body:",
        rawErrorText
      );
      return [];
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      console.error("[connections] Unexpected response shape:", JSON.stringify(json));
      return [];
    }

    const cleaned = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("[connections] Could not parse LLM JSON:", cleaned);
      return [];
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>).connections)
    ) {
      console.error("[connections] Malformed connections object:", JSON.stringify(parsed));
      return [];
    }

    const raw = (parsed as { connections: unknown[] }).connections;
    const seen = new Set<string>();
    const result: ConnectionPair[] = [];

    for (const item of raw) {
      if (result.length >= MAX_CONNECTIONS) break;
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as Record<string, unknown>).sourceId !== "string" ||
        typeof (item as Record<string, unknown>).targetId !== "string" ||
        typeof (item as Record<string, unknown>).reason !== "string"
      ) {
        continue;
      }

      const { sourceId: shortSrc, targetId: shortTgt, reason } = item as {
        sourceId: string;
        targetId: string;
        reason: string;
      };

      // Map short IDs back to real UUIDs
      const sourceId = shortToReal.get(shortSrc);
      const targetId = shortToReal.get(shortTgt);
      if (!sourceId || !targetId) continue;
      if (sourceId === targetId) continue;

      const key = [sourceId, targetId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      result.push({
        sourceId,
        targetId,
        reason: reason.trim().slice(0, MAX_REASON_LENGTH),
      });
    }

    return result;
  } catch (err) {
    console.error("[connections] Unexpected error:", err);
    return [];
  }
}
