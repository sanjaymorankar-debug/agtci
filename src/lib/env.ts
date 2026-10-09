/**
 * Environment configuration, validated once at process start.
 * Mirrors the pattern used across the Bkesari/GoKesari codebase.
 */
import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  AUTH_URL: z.string().url().optional(),

  // WhatsApp click-to-chat number, digits only with country code (e.g. 91XXXXXXXXXX).
  WHATSAPP_NUMBER: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Validate one set of variables, with no caching.
 *
 * Split out of getEnv() so it can be tested: getEnv() memoises on purpose, and
 * a memoised function can only be asked one question per process. Takes the
 * source explicitly rather than reading process.env, so a test can hand it a
 * missing or malformed value without mutating the real environment.
 */
export function parseEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  // An unset variable and one set to "" mean the same thing here. Hosting
  // panels and CI commonly write an empty string for "not set", and zod would
  // otherwise accept "" for a field whose whole point is to be non-empty.
  const raw: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    raw[key] = value === "" ? undefined : value;
  }

  const parsed = serverEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function getEnv(): ServerEnv {
  if (cached) return cached;
  cached = parseEnv();
  return cached;
}
