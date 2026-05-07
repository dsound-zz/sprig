import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps, nodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromRequest } from "@/lib/auth/session";
import { suggestChildLabels } from "@/lib/llm/suggest";

type RouteContext = { params: { mapId: string } };

export async function POST(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  // --- Auth ---
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- Parse body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { nodeId, label: labelOverride } = body as Record<string, unknown>;

  if (typeof nodeId !== "string" || nodeId.trim() === "") {
    return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  }

  // --- Validate map ownership ---
  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, params.mapId), eq(maps.userId, session.userId)))
    .limit(1);

  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  // --- Look up the target node (optional if label is provided) ---
  const [targetNode] = await db
    .select({ id: nodes.id, label: nodes.label, mapId: nodes.mapId })
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.mapId, params.mapId)))
    .limit(1);

  const conceptLabel =
    typeof labelOverride === "string" && labelOverride.trim().length > 0
      ? labelOverride.trim()
      : targetNode?.label;

  if (!conceptLabel) {
    return NextResponse.json({ error: "Node not found and no label provided" }, { status: 404 });
  }

  // --- Collect all existing labels for this map (excluding ghost nodes handled client-side) ---
  const allMapNodes = await db
    .select({ label: nodes.label })
    .from(nodes)
    .where(eq(nodes.mapId, params.mapId));

  const existingLabels = allMapNodes
    .map((n) => n.label)
    .filter((l): l is string => typeof l === "string" && l.trim().length > 0);

  // --- Call LLM ---
  let suggestions: string[];
  try {
    suggestions = await suggestChildLabels(conceptLabel, existingLabels);
  } catch (err) {
    console.error("[suggest route] LLM error:", err);
    return NextResponse.json({ error: "LLM request failed" }, { status: 500 });
  }

  return NextResponse.json({ suggestions });
}
