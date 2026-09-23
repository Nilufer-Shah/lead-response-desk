import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TZ: z.string().default("Asia/Kolkata"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).default("postgres://lead_desk:lead_desk@localhost:5432/lead_desk"),
  DEFAULT_TENANT_ID: z.string().uuid().default("11111111-1111-4111-8111-111111111111"),
  BOOTSTRAP_OWNER_EMAIL: z.string().email().optional(),
  BOOTSTRAP_OWNER_NAME: z.string().min(2).default("Owner"),
  BOOTSTRAP_OWNER_PASSWORD: z.string().min(10).optional(),
  OWNER_RESET_PASSWORD: z.string().min(10).optional(),
  SESSION_SECRET: z.string().min(32).default("development-only-session-secret-change-me"),
  META_CONNECTION_ENABLED: z.enum(["true", "false"]).default("false"),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_SYSTEM_USER_TOKEN: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v26.0"),
  GOOGLE_SHEETS_ENABLED: z.enum(["true", "false"]).default("false"),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SHEETS_POLL_MINUTES: z.coerce.number().int().min(1).max(60).default(1),
});

export type Environment = z.infer<typeof schema>;

let cached: Environment | undefined;

export function env(): Environment {
  cached ??= schema.parse(process.env);
  return cached;
}
