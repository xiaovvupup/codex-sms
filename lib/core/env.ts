import { z } from "zod";

const WRAPPING_QUOTES_REGEX = /^[`"'“”‘’]+|[`"'“”‘’]+$/g;
const LEGACY_COUNTRY_CODE_MAP: Record<string, { name: string; label: string; prefix: string }> = {
  "10": { name: "vietnam", label: "越南", prefix: "+84" }
};

function sanitizeEnvString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return value.trim().replace(WRAPPING_QUOTES_REGEX, "");
}

function sanitizeEnvStringOrUndefined(value: unknown) {
  const sanitized = sanitizeEnvString(value);
  if (typeof sanitized !== "string" || sanitized.length === 0) {
    return undefined;
  }
  return sanitized;
}

function parseBooleanEnv(value: string, defaultValue: boolean) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return defaultValue;
}

function normalizeSmsApiBaseUrl(value: unknown) {
  const sanitized = sanitizeEnvStringOrUndefined(value);
  if (!sanitized) {
    return "http://api1.5sim.net/stubs/handler_api.php";
  }
  if (sanitized.includes("$5sim.net")) {
    return sanitized.replace("$5sim.net", "5sim.net");
  }
  if (sanitized.includes("/v1")) {
    return sanitized.replace(/\/+$/, "");
  }
  return sanitized.replace(/\/+$/, "");
}

function resolveCountryFromLegacyCode(legacyCountryCode: unknown) {
  const code = sanitizeEnvStringOrUndefined(legacyCountryCode);
  if (!code) {
    return undefined;
  }
  return LEGACY_COUNTRY_CODE_MAP[code];
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/activation_sms?schema=public"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(32).default("local_dev_only_jwt_secret_change_before_production"),
  SMS_PROVIDER: z.enum(["5sim"]).default("5sim"),
  SMS_API_MODE: z.enum(["auto", "rest", "api1"]).default("auto"),
  SMS_API_BASE_URL: z.preprocess(normalizeSmsApiBaseUrl, z.string().url()).default("http://api1.5sim.net/stubs/handler_api.php"),
  SMS_API_KEY: z.string().min(1).default("DUMMY_SMS_API_KEY"),
  SMS_PRODUCT_CODE: z.preprocess(
    (value) => sanitizeEnvStringOrUndefined(value) ?? sanitizeEnvStringOrUndefined(process.env.SMS_SERVICE_CODE) ?? "openai",
    z.string().min(1)
  ),
  SMS_COUNTRY_NAME: z.preprocess(
    (value) => sanitizeEnvStringOrUndefined(value) ?? resolveCountryFromLegacyCode(process.env.SMS_COUNTRY_CODE)?.name ?? "vietnam",
    z.string().min(1)
  ),
  SMS_COUNTRY_LABEL: z.preprocess(
    (value) => sanitizeEnvStringOrUndefined(value) ?? resolveCountryFromLegacyCode(process.env.SMS_COUNTRY_CODE)?.label ?? "越南",
    z.string().min(1)
  ),
  SMS_COUNTRY_PREFIX: z.preprocess(
    (value) => sanitizeEnvStringOrUndefined(value) ?? resolveCountryFromLegacyCode(process.env.SMS_COUNTRY_CODE)?.prefix ?? "+84",
    z.string().min(1)
  ),
  SMS_OPERATOR: z.string().min(1).default("any"),
  SMS_MAX_PRICE: z.coerce.number().positive().optional(),
  SMS_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  SESSION_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(5),
  CHANGE_NUMBER_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(150),
  MAX_NUMBER_CHANGES: z.coerce.number().int().min(0).default(5),
  ACTIVATION_CODES_TXT_PATH: z.string().default("./data/activation-codes.txt"),
  REDEEM_RATE_LIMIT: z.coerce.number().int().positive().default(5),
  SESSION_RATE_LIMIT: z.coerce.number().int().positive().default(60),
  ADMIN_RATE_LIMIT: z.coerce.number().int().positive().default(120),
  WEBHOOK_TOKEN: z.string().optional(),
  WEBHOOK_IP_WHITELIST: z.string().default("84.32.223.53,185.138.88.87"),
  ADMIN_SEED_EMAIL: z.preprocess(sanitizeEnvString, z.string().email().default("admin@example.com")).transform((value) =>
    value.toLowerCase()
  ),
  ADMIN_SEED_PASSWORD: z.preprocess(sanitizeEnvString, z.string().min(8).default("ChangeMe123!")),
  ADMIN_SINGLE_ACCOUNT_MODE: z.preprocess(sanitizeEnvString, z.string().default("true")).transform((value) =>
    parseBooleanEnv(value, true)
  ),
  AUTO_GENERATE_UNUSED_THRESHOLD: z.coerce.number().int().min(1).default(20),
  AUTO_GENERATE_BATCH_SIZE: z.coerce.number().int().min(1).default(400),
  LOW_BALANCE_THRESHOLD_USD: z.coerce.number().positive().default(1),
  CRON_SECRET: z.preprocess(sanitizeEnvString, z.string().optional()),
  MAIL_ENABLED: z.preprocess(sanitizeEnvString, z.string().default("false")).transform((value) =>
    parseBooleanEnv(value, false)
  ),
  MAIL_SMTP_HOST: z.preprocess(sanitizeEnvString, z.string().optional()),
  MAIL_SMTP_PORT: z.coerce.number().int().positive().default(587),
  MAIL_SMTP_SECURE: z.preprocess(sanitizeEnvString, z.string().default("false")).transform((value) =>
    parseBooleanEnv(value, false)
  ),
  MAIL_SMTP_USER: z.preprocess(sanitizeEnvString, z.string().optional()),
  MAIL_SMTP_PASS: z.preprocess(sanitizeEnvString, z.string().optional()),
  MAIL_FROM: z.preprocess(sanitizeEnvString, z.string().optional()),
  MAIL_TO: z.preprocess(sanitizeEnvString, z.string().optional()),
  PHONE_NOTIFY_EMAIL: z.preprocess(sanitizeEnvString, z.string().email().default("xiaovvupup@163.com")),
  MAX_CODE_REFRESHES: z.coerce.number().int().min(0).default(2)
});

export const env = envSchema.parse(process.env);
