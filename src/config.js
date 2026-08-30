import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(customParseFormat);
dayjs.extend(utc);

export const COLLECTION_NAMES = ["devicestatus", "treatments", "entries"];
export const DATE_FIELD = "created_at";
export const DATE_FORMAT = "YYYY-MM-DD";
export const PREVIEW_SIZE = 3;

export function fail(message) {
  console.error(message);
  process.exit(1);
}

// Keep the last 3 whole months: everything before the 1st of that window goes.
// created_at is stored as a UTC ISO string, so the cutoff is UTC too.
export function defaultCutoffDate() {
  return dayjs.utc().subtract(2, "M").startOf("M");
}

export function loadEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  config({ path: join(root, ".env") });

  const uri = process.env.MONGO_URI;
  const dbName = process.env.DB_NAME;

  if (!uri) fail("MONGO_URI is not set. Re-run the setup, or edit the .env file.");
  if (!dbName) fail("DB_NAME is not set in .env.");

  return { uri, dbName };
}
