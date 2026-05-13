import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps, nodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromRequest } from "@/lib/auth/session";
import { findConnections } from "@/lib/llm/connections";

type RouteContext = { params: { mapId: string } };

export async function POST(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, params.mapId), eq(maps.userId, session.userId)))
    .limit(1);

  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const mapNodes = await db
    .select({ id: nodes.id, label: nodes.label, parentId: nodes.parentId })
    .from(nodes)
    .where(eq(nodes.mapId, params.mapId));

  const labeledNodes = mapNodes.filter((n) => n.label.trim().length > 0);

  if (labeledNodes.length < 4) {
    return NextResponse.json(
      { error: "Not enough labeled nodes to find connections" },
      { status: 400 }
    );
  }

  try {
    const connections = await findConnections(labeledNodes);
    return NextResponse.json({ connections });
  } catch {
    console.error("[connections route] Unexpected error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
