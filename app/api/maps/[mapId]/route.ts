import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps, nodes, edges } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromRequest } from "@/lib/auth/session";

type RouteContext = { params: { mapId: string } };

async function assertMapOwnership(
  mapId: string,
  userId: string
): Promise<boolean> {
  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.userId, userId)))
    .limit(1);
  return Boolean(map);
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const owned = await assertMapOwnership(params.mapId, session.userId);
  if (!owned) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const [map] = await db
    .select()
    .from(maps)
    .where(eq(maps.id, params.mapId))
    .limit(1);

  const mapNodes = await db
    .select()
    .from(nodes)
    .where(eq(nodes.mapId, params.mapId));

  const mapEdges = await db
    .select()
    .from(edges)
    .where(eq(edges.mapId, params.mapId));

  return NextResponse.json({ map, nodes: mapNodes, edges: mapEdges });
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const owned = await assertMapOwnership(params.mapId, session.userId);
  if (!owned) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
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

  const payload = body as {
    title?: string;
    nodes?: { id: string; positionX?: number; positionY?: number; label?: string }[];
  };

  const now = new Date();

  // Update map title if provided
  if (typeof payload.title === "string" && payload.title.trim().length > 0) {
    await db
      .update(maps)
      .set({ title: payload.title.trim(), updatedAt: now })
      .where(eq(maps.id, params.mapId));
  } else {
    await db
      .update(maps)
      .set({ updatedAt: now })
      .where(eq(maps.id, params.mapId));
  }

  // Update individual node positions/labels
  if (Array.isArray(payload.nodes)) {
    for (const nodeUpdate of payload.nodes) {
      if (typeof nodeUpdate.id !== "string") continue;

      const updateValues: Partial<{
        positionX: number;
        positionY: number;
        label: string;
      }> = {};

      if (typeof nodeUpdate.positionX === "number") {
        updateValues.positionX = nodeUpdate.positionX;
      }
      if (typeof nodeUpdate.positionY === "number") {
        updateValues.positionY = nodeUpdate.positionY;
      }
      if (
        typeof nodeUpdate.label === "string" &&
        nodeUpdate.label.length <= 15
      ) {
        updateValues.label = nodeUpdate.label;
      }

      if (Object.keys(updateValues).length > 0) {
        await db
          .update(nodes)
          .set(updateValues)
          .where(
            and(eq(nodes.id, nodeUpdate.id), eq(nodes.mapId, params.mapId))
          );
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const owned = await assertMapOwnership(params.mapId, session.userId);
  if (!owned) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  await db.delete(maps).where(eq(maps.id, params.mapId));

  return NextResponse.json({ ok: true });
}
