import { env } from "../src/lib/env";

const config = env();
const production = process.argv.includes("--production") || config.NODE_ENV === "production";
const errors: string[] = [];
const warnings: string[] = [];

if (production) {
  if (config.DEMO_MODE !== "false") errors.push("DEMO_MODE must be false");
  if (!config.APP_URL.startsWith("https://")) errors.push("APP_URL must use HTTPS");
  if (config.APP_URL.includes("localhost")) errors.push("APP_URL must use the approved public domain");
  if (config.SESSION_SECRET.includes("development-only") || config.SESSION_SECRET.includes("replace-with")) errors.push("SESSION_SECRET must be replaced");
  if (config.DATABASE_URL.includes("localhost")) warnings.push("DATABASE_URL points to localhost; this is valid only when the check runs inside the Compose network");
  if (config.OTP_DELIVERY_MODE === "console") errors.push("OTP_DELIVERY_MODE cannot be console in production");
  if (!config.SMTP_URL) errors.push("SMTP_URL is required for owner, manager, agency, and admin magic links");
  if (!config.SMS_WEBHOOK_URL) errors.push("SMS_WEBHOOK_URL is required for salesperson phone OTP delivery");
  if (!config.BOOTSTRAP_ADMIN_EMAIL) errors.push("BOOTSTRAP_ADMIN_EMAIL is required so the first administrator can sign in");
  if (config.REPORTS_DIR.startsWith("/tmp")) errors.push("REPORTS_DIR must use persistent storage in production");
  if (!process.env.POSTGRES_OWNER_PASSWORD || process.env.POSTGRES_OWNER_PASSWORD.startsWith("replace")) errors.push("POSTGRES_OWNER_PASSWORD must be replaced");
  if (!process.env.POSTGRES_APP_PASSWORD || process.env.POSTGRES_APP_PASSWORD.startsWith("replace")) errors.push("POSTGRES_APP_PASSWORD must be replaced");
}
if (config.GOOGLE_SHEETS_ENABLED === "true" && (!config.GOOGLE_SERVICE_ACCOUNT_EMAIL || !config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)) errors.push("Google Sheets is enabled but service account credentials are incomplete");
if (config.META_CONNECTION_ENABLED === "true") errors.push("Meta must remain disabled until the final connection stage");
if (config.WHATSAPP_PROVIDER === "disabled") warnings.push("WhatsApp delivery is disabled; call actions still work, but automated WhatsApp delivery will not send");

process.stdout.write(`Launch preflight (${production ? "production" : "development"})\n`);
process.stdout.write(`- app: ${config.APP_URL}\n- demo mode: ${config.DEMO_MODE}\n- Google Sheets: ${config.GOOGLE_SHEETS_ENABLED === "true" ? "enabled" : "disabled"}\n- Meta: deferred\n`);
for (const warning of warnings) process.stdout.write(`WARNING: ${warning}\n`);
for (const error of errors) process.stderr.write(`ERROR: ${error}\n`);
if (errors.length) process.exitCode = 1;
else process.stdout.write("Preflight passed\n");
