import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nodes, maps } from "@/lib/db/schema";
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

  const {
    mapId,
    parentId = null,
    label,
    fullConcept = "",
    positionX,
    positionY,
    depth = 0,
  } = body as Record<string, unknown>;

  if (typeof mapId !== "string" || typeof label !== "string") {
    return NextResponse.json(
      { error: "mapId and label are required strings" },
      { status: 400 }
    );
  }

  if (label.length > 20) {
    return NextResponse.json(
      { error: "label must be 20 characters or fewer" },
      { status: 400 }
    );
  }

  if (typeof positionX !== "number" || typeof positionY !== "number") {
    return NextResponse.json(
      { error: "positionX and positionY must be numbers" },
      { status: 400 }
    );
  }

  // Verify the map belongs to this user
  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.userId, session.userId)))
    .limit(1);

  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const [node] = await db
    .insert(nodes)
    .values({
      mapId,
      parentId: typeof parentId === "string" ? parentId : null,
      label,
      fullConcept: typeof fullConcept === "string" ? fullConcept : label,
      positionX,
      positionY,
      depth: typeof depth === "number" ? depth : 0,
    })
    .returning();

  return NextResponse.json({ node }, { status: 201 });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nodeId = request.nextUrl.searchParams.get("nodeId");
  if (!nodeId) {
    return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  }

  // Verify the node belongs to a map owned by this user
  const [node] = await db
    .select({ id: nodes.id, mapId: nodes.mapId })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .limit(1);

  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, node.mapId), eq(maps.userId, session.userId)))
    .limit(1);

  if (!map) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Recursively delete all child nodes (DB cascade handles edges and children
  // only if FK is cascade — but Postgres set null won't cascade children deletion.
  // So we do a recursive delete here.)
  await deleteNodeAndDescendants(nodeId);

  return NextResponse.json({ ok: true });
}

async function deleteNodeAndDescendants(nodeId: string): Promise<void> {
  const children = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.parentId, nodeId));

  for (const child of children) {
    await deleteNodeAndDescendants(child.id);
  }

  await db.delete(nodes).where(eq(nodes.id, nodeId));
}
