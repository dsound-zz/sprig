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
 * Groups nodes by their depth-1 branch so the model clearly understands
 * which nodes share a branch vs. which are candidates for cross-linking.
 * Uses short indices (n0, n1, ...) to avoid UUID hallucination.
 * Deduplicates (A→B)/(B→A). Caps at 8 pairs.
 * Returns [] on any failure — never throws.
 */
export async function findConnections(nodes: NodeInput[]): Promise<ConnectionPair[]> {
  const apiKey = process.env.TOGETHER_AI;
  if (!apiKey) {
    console.error("[connections] TOGETHER_AI env var is undefined at runtime");
    return [];
  }

  const nonRootNodes = nodes.filter((n) => n.parentId !== null);
  if (nonRootNodes.length < 2) return [];

  // Assign short IDs
  const shortId = (i: number) => `n${i}`;
  const realToShort = new Map(nonRootNodes.map((n, i) => [n.id, shortId(i)]));
  const shortToReal = new Map(nonRootNodes.map((n, i) => [shortId(i), n.id]));

  // Find depth-1 nodes: those whose parent is NOT in nonRootNodes (i.e. parent = root)
  const nonRootIds = new Set(nonRootNodes.map((n) => n.id));
  const depth1Nodes = nonRootNodes.filter((n) => !nonRootIds.has(n.parentId!));
  const depth1Ids = new Set(depth1Nodes.map((n) => n.id));

  // Walk up to find which depth-1 branch a node belongs to
  const parentMap = new Map(nonRootNodes.map((n) => [n.id, n.parentId]));
  function getBranchId(nodeId: string): string | null {
    let current = nodeId;
    for (let i = 0; i < 20; i++) {
      if (depth1Ids.has(current)) return current;
      const pid = parentMap.get(current);
      if (!pid) return null;
      current = pid;
    }
    return null;
  }

  // Group nodes by branch
  const branchGroups = new Map<string, NodeInput[]>();
  for (const d1 of depth1Nodes) branchGroups.set(d1.id, [d1]);
  for (const node of nonRootNodes) {
    if (depth1Ids.has(node.id)) continue;
    const bid = getBranchId(node.id);
    if (bid) branchGroups.get(bid)?.push(node);
  }

  // Build branch descriptions using short IDs
  const branchLabels = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const branchLines: string[] = [];
  let bi = 0;
  for (const members of Array.from(branchGroups.values())) {
    const label = branchLabels[bi++] ?? `Branch${bi}`;
    const memberStr = members
      .map((n: NodeInput) => `${realToShort.get(n.id)}="${n.label}"`)
      .join(", ");
    branchLines.push(`Branch ${label}: ${memberStr}`);
  }

  if (branchLines.length < 2) return [];

  const prompt = `You are analyzing a mind map. Nodes are grouped into branches below.
Find pairs of nodes from DIFFERENT branches that are meaningfully related.

${branchLines.join("\n")}

Rules:
- Only pair nodes from different branches (different letters)
- Maximum 8 pairs
- Each reason must be 40 characters or fewer
- Return ONLY valid JSON, no markdown, no explanation
Format: { "connections": [{ "sourceId": "n0", "targetId": "n3", "reason": "brief reason" }] }`;

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
        max_tokens: 600,
        temperature: 0.4,
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

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[connections] No JSON object found in response. Raw content:", content);
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("[connections] Could not parse LLM JSON. Raw content:", content);
      return [];
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>).connections)
    ) {
      console.error("[connections] Malformed response:", JSON.stringify(parsed));
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

      const sourceId = shortToReal.get(shortSrc);
      const targetId = shortToReal.get(shortTgt);
      if (!sourceId || !targetId || sourceId === targetId) continue;

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
