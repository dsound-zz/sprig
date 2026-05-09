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

  if (label.length > 50) {
    return NextResponse.json(
      { error: "label must be 50 characters or fewer" },
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
  const parentIdParam = request.nextUrl.searchParams.get("parentId");

  if (!nodeId && !parentIdParam) {
    return NextResponse.json({ error: "nodeId or parentId is required" }, { status: 400 });
  }

  // --- Validate ownership ---
  // If nodeId is provided, we check that node.
  // If parentId is provided, we check the parent node.
  const targetId = nodeId || parentIdParam;
  const [targetNode] = await db
    .select({ id: nodes.id, mapId: nodes.mapId })
    .from(nodes)
    .where(eq(nodes.id, targetId as string))
    .limit(1);

  if (!targetNode) {
    return NextResponse.json({ error: "Target node not found" }, { status: 404 });
  }

  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, targetNode.mapId), eq(maps.userId, session.userId)))
    .limit(1);

  if (!map) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Use a single DB transaction to prevent orphaned nodes on failure
  await db.transaction(async (tx) => {
    if (nodeId) {
      await deleteNodeAndDescendants(nodeId, tx);
    } else if (parentIdParam) {
      const children = await tx
        .select({ id: nodes.id })
        .from(nodes)
        .where(eq(nodes.parentId, parentIdParam));
      
      for (const child of children) {
        await deleteNodeAndDescendants(child.id, tx);
      }
    }
  });

  return NextResponse.json({ ok: true });
}

async function deleteNodeAndDescendants(nodeId: string, tx: any): Promise<void> {
  const children = await tx
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.parentId, nodeId));

  for (const child of children) {
    await deleteNodeAndDescendants(child.id, tx);
  }

  await tx.delete(nodes).where(eq(nodes.id, nodeId));
}
