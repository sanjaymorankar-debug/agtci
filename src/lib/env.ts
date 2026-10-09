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

  // Sign-in for the client area, through bkesari.com (OpenID Connect; see
  // src/server/sso). All three OIDC_* unset = no sign-in, public pages only.
  // The issuer is the bkesari.com tier this tier pairs with:
  //   dev.agtci.com -> https://dev.bkesari.com/auth, agtci.com -> https://bkesari.com/auth
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  // This site's own origin, e.g. https://dev.agtci.com. The redirect URI is
  // <AGTCI_URL>/auth/callback and must be registered exactly on bkesari.com.
  AGTCI_URL: z.string().url().optional(),
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
