/**
 * node-postgres settings shared by the app's pool and the migrate script.
 *
 * Production runs on Neon, which shapes three of them:
 * - An idle Neon compute is suspended and its connections are closed from the
 *   server side. pg reports that as an `error` event on the pool, and an
 *   unhandled `error` event is an uncaught exception, so every pool gets a
 *   handler (`handlePoolErrors`).
 * - The first connection after a suspend waits for the compute to start, so
 *   the connect timeout must not be short. pg's default is to wait forever.
 * - Neon connection strings end in `?sslmode=require&channel_binding=require`.
 *   pg 8 treats `sslmode=require` as full certificate verification (it prints
 *   a deprecation warning saying so) and ignores `channel_binding`, so the
 *   latter is mapped to pg's own `enableChannelBinding` option here.
 */
import type { Pool, PoolConfig } from "pg";

/** Long enough for a suspended Neon compute to wake up. */
export const CONNECT_TIMEOUT_MS = 15_000;

/** Close connections idle this long; Neon may close them sooner itself. */
export const IDLE_TIMEOUT_MS = 10_000;

function wantsChannelBinding(connectionString: string): boolean {
  try {
    const mode = new URL(connectionString).searchParams.get("channel_binding");
    return mode === "require" || mode === "prefer";
  } catch {
    return false;
  }
}

export function poolConfig(connectionString: string, overrides: PoolConfig = {}): PoolConfig {
  return {
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    enableChannelBinding: wantsChannelBinding(connectionString),
    ...overrides,
  };
}

/**
 * Log, rather than crash on, errors from idle pooled connections, such as a
 * Neon compute suspending or a server restart. The pool has already dropped
 * the broken connection; the next query opens a new one.
 */
export function handlePoolErrors(pool: Pool, label: string): Pool {
  pool.on("error", (err: Error & { code?: string }) => {
    console.error(`[db:${label}] idle connection closed: ${err.code ?? "error"} ${err.message}`);
  });
  return pool;
}
