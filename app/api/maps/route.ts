import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionFromRequest } from "@/lib/auth/session";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userMaps = await db
    .select({
      id: maps.id,
      title: maps.title,
      createdAt: maps.createdAt,
      updatedAt: maps.updatedAt,
    })
    .from(maps)
    .where(eq(maps.userId, session.userId))
    .orderBy(desc(maps.updatedAt));

  return NextResponse.json({ maps: userMaps });
}

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

  if (
    typeof body !== "object" ||
    body === null ||
    !("title" in body) ||
    typeof (body as Record<string, unknown>).title !== "string"
  ) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const title = ((body as Record<string, unknown>).title as string).trim();

  if (title.length === 0) {
    return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
  }

  const [map] = await db
    .insert(maps)
    .values({ userId: session.userId, title })
    .returning({ id: maps.id, title: maps.title });

  return NextResponse.json({ map }, { status: 201 });
}
