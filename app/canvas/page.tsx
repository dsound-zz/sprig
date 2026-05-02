import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { CanvasShell } from "@/components/canvas/CanvasShell";
import { SliderBar } from "@/components/ui/SliderBar";

export default async function CanvasPage() {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await getSession(token) : null;

  if (!session) {
    redirect("/");
  }

  const [latestMap] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(eq(maps.userId, session.userId))
    .orderBy(desc(maps.updatedAt))
    .limit(1);

  return (
    <div className="w-screen h-screen overflow-hidden bg-[#FAFAF8] dark:bg-[#111110]">
      <CanvasShell
        initialMapId={latestMap?.id ?? null}
        userId={session.userId}
      />
      <SliderBar />
    </div>
  );
}
