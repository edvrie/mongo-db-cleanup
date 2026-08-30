// Loads Nightscout-shaped fixture data into the sandbox Mongo.
// Safety rail: refuses to run against anything but a local sandbox URI.
import { MongoClient } from "mongodb";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

const URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27018";
const DB_NAME = process.env.DB_NAME ?? "nightscout_sandbox";

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27018\b/.test(URI)) {
  console.error(
    `Refusing to seed ${URI} — the seeder only targets the local sandbox on port 27018.`
  );
  process.exit(1);
}

// Six months back from a fixed "now" so runs are reproducible.
const NOW = dayjs.utc().startOf("day");
const stamp = (daysAgo, minutes = 0) =>
  NOW.subtract(daysAgo, "day").add(minutes, "minute");

const entries = [];
const treatments = [];
const devicestatus = [];

for (let day = 180; day >= 0; day--) {
  // ~12 glucose readings a day, enough to be realistic without being huge.
  for (let i = 0; i < 12; i++) {
    const at = stamp(day, i * 120);
    entries.push({
      type: "sgv",
      sgv: 80 + ((day * 7 + i * 13) % 140),
      direction: "Flat",
      device: "share2",
      date: at.valueOf(),
      dateString: at.toISOString(),
      created_at: at.toISOString(),
    });
  }

  if (day % 2 === 0) {
    const at = stamp(day, 420);
    treatments.push({
      eventType: day % 6 === 0 ? "Meal Bolus" : "Correction Bolus",
      insulin: Number((0.5 + (day % 5) * 0.4).toFixed(1)),
      carbs: day % 6 === 0 ? 30 + (day % 40) : null,
      enteredBy: "sandbox",
      created_at: at.toISOString(),
    });
  }

  if (day % 3 === 0) {
    const at = stamp(day, 60);
    devicestatus.push({
      device: "openaps://sandbox",
      uploader: { battery: 40 + (day % 60) },
      created_at: at.toISOString(),
    });
  }
}

// Two edge cases worth having in every test run:
// 1. a document stamped exactly at a month boundary, to prove $lt keeps it;
// 2. documents with no created_at at all, which must never be deleted.
const boundary = NOW.subtract(2, "M").startOf("M");
entries.push({
  type: "sgv",
  sgv: 100,
  note: "exactly at the default cutoff — must survive",
  date: boundary.valueOf(),
  dateString: boundary.toISOString(),
  created_at: boundary.toISOString(),
});
entries.push({ type: "sgv", sgv: 111, note: "no created_at — must survive" });
treatments.push({ eventType: "Note", notes: "no created_at — must survive" });

const client = new MongoClient(URI);

try {
  await client.connect();
  const db = client.db(DB_NAME);

  for (const [name, docs] of [
    ["entries", entries],
    ["treatments", treatments],
    ["devicestatus", devicestatus],
  ]) {
    const collection = db.collection(name);
    await collection.deleteMany({});
    await collection.insertMany(docs);
    await collection.createIndex({ created_at: 1 });
    console.log(`${name}: seeded ${docs.length} documents`);
  }

  console.log(
    `\nSeeded ${DB_NAME} at ${URI}` +
      `\nOldest: ${stamp(180).toISOString()}` +
      `\nDefault cutoff would be: ${boundary.toISOString()}`
  );
} finally {
  await client.close();
}
