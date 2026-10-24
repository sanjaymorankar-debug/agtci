/**
 * Environment configuration, validated once at process start.
 * Mirrors the pattern used across the Bkesari/GoKesari codebase.
 */
import { z } from "zod";

// Catches a .env still holding the old mysql:// URL before pg reports something obscure.
const postgresUrl = /^postgres(ql)?:\/\//;

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Neon: DATABASE_URL is the pooled endpoint (runtime), DATABASE_URL_UNPOOLED
  // the direct one (migrations). Locally and in CI, DATABASE_URL alone is fine.
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .regex(postgresUrl, "DATABASE_URL must be a postgres:// or postgresql:// URL"),
  DATABASE_URL_UNPOOLED: z
    .string()
    .regex(postgresUrl, "DATABASE_URL_UNPOOLED must be a postgres:// or postgresql:// URL")
    .optional(),

  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  AUTH_URL: z.string().url().optional(),

  // WhatsApp click-to-chat number, digits only with country code (e.g. 91XXXXXXXXXX).
  WHATSAPP_NUMBER: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (cached) return cached;

  const raw: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    raw[key] = value === "" ? undefined : value;
  }

  const parsed = serverEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
