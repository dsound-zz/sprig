import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { edges, maps, nodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromRequest } from "@/lib/auth/session";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { mapId, sourceId, targetId, edgeType } = body as Record<string, unknown>;

  if (
    typeof mapId !== "string" ||
    typeof sourceId !== "string" ||
    typeof targetId !== "string"
  ) {
    return NextResponse.json(
      { error: "mapId, sourceId, and targetId are required strings" },
      { status: 400 }
    );
  }

  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.userId, session.userId)))
    .limit(1);

  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const [sourceNode] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(eq(nodes.id, sourceId), eq(nodes.mapId, mapId)))
    .limit(1);

  if (!sourceNode) {
    return NextResponse.json({ error: "Source node not found" }, { status: 404 });
  }

  const [targetNode] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(eq(nodes.id, targetId), eq(nodes.mapId, mapId)))
    .limit(1);

  if (!targetNode) {
    return NextResponse.json({ error: "Target node not found" }, { status: 404 });
  }

  const edgeTypeValue =
    typeof edgeType === "string" &&
    (edgeType === "tree" || edgeType === "connection")
      ? edgeType
      : "tree";

  const [edge] = await db
    .insert(edges)
    .values({ mapId, sourceId, targetId, edgeType: edgeTypeValue })
    .returning();

  return NextResponse.json({ edge }, { status: 201 });
}
