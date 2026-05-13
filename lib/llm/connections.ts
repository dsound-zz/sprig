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

  const prompt = `You are analyzing a mind map. Given these nodes and their parent relationships, \
identify pairs of nodes from DIFFERENT branches that are meaningfully related \
to each other — not just because they share a common ancestor.

Nodes (id: label, parentId):
${nonRootNodes.map((n) => `${n.id}: "${n.label}", parent: ${n.parentId}`).join("\n")}

Rules:
- Only pair nodes that are on different branches (different direct children of root)
- Maximum 8 pairs
- Each reason must be 40 characters or fewer
- Do not pair a node with its own ancestor or descendant
- Return ONLY valid JSON, no markdown, no explanation
Format: { "connections": [{ "sourceId": "...", "targetId": "...", "reason": "..." }] }`;

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
    const nodeIdSet = new Set(nonRootNodes.map((n) => n.id));
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

      const { sourceId, targetId, reason } = item as {
        sourceId: string;
        targetId: string;
        reason: string;
      };

      if (!nodeIdSet.has(sourceId) || !nodeIdSet.has(targetId)) continue;
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
