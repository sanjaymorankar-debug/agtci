/**
 * GET /api/health: is the app up, and can it reach its database?
 *
 * For uptime checks and the smoke test. It runs one `select 1` through the
 * app's pool, so it proves the pooled connection string, TLS and pool
 * recovery work. It never returns error details: those go to the server log.
 */
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    // Imported here, not at the top, so `next build` does not need the
    // database settings: the pool is created on the first request.
    const { db } = await import("@/server/db");
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", database: "up" }, { headers });
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error(`[health] database check failed: ${e.code ?? e.name} ${e.message}`);
    return Response.json({ status: "error", database: "down" }, { status: 503, headers });
  }
}
