import { env } from "../src/lib/env";

const config = env();
const production = process.argv.includes("--production") || config.NODE_ENV === "production";
const errors: string[] = [];
const warnings: string[] = [];

if (production) {
  if (!config.APP_URL.startsWith("https://")) errors.push("APP_URL must use HTTPS");
  if (config.APP_URL.includes("localhost")) errors.push("APP_URL must use the approved public domain");
  if (config.SESSION_SECRET.includes("development-only") || config.SESSION_SECRET.includes("replace-with")) errors.push("SESSION_SECRET must be replaced");
  if (config.DATABASE_URL.includes("localhost")) warnings.push("DATABASE_URL points to localhost; this is valid only when the check runs inside the Compose network");
  if (!config.BOOTSTRAP_OWNER_EMAIL) errors.push("BOOTSTRAP_OWNER_EMAIL is required so the first owner can sign in");
  if (!config.BOOTSTRAP_OWNER_PASSWORD) errors.push("BOOTSTRAP_OWNER_PASSWORD is required for first deployment");
  if (!process.env.POSTGRES_OWNER_PASSWORD || process.env.POSTGRES_OWNER_PASSWORD.startsWith("replace")) errors.push("POSTGRES_OWNER_PASSWORD must be replaced");
  if (!process.env.POSTGRES_APP_PASSWORD || process.env.POSTGRES_APP_PASSWORD.startsWith("replace")) errors.push("POSTGRES_APP_PASSWORD must be replaced");
}
if (config.GOOGLE_SHEETS_ENABLED === "true" && (!config.GOOGLE_SERVICE_ACCOUNT_EMAIL || !config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)) errors.push("Google Sheets is enabled but service account credentials are incomplete");
if (config.META_CONNECTION_ENABLED === "true" && (!config.META_APP_ID || !config.META_APP_SECRET || !config.META_VERIFY_TOKEN || !config.META_SYSTEM_USER_TOKEN)) errors.push("Meta is enabled but app, signature, verification or system-user credentials are incomplete");

process.stdout.write(`Launch preflight (${production ? "production" : "development"})\n`);
process.stdout.write(`- app: ${config.APP_URL}\n- Google Sheets: ${config.GOOGLE_SHEETS_ENABLED === "true" ? "enabled" : "disabled"}\n- Meta: ${config.META_CONNECTION_ENABLED === "true" ? "enabled" : "disabled"}\n`);
for (const warning of warnings) process.stdout.write(`WARNING: ${warning}\n`);
for (const error of errors) process.stderr.write(`ERROR: ${error}\n`);
if (errors.length) process.exitCode = 1;
else process.stdout.write("Preflight passed\n");
