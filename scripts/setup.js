// Interactive .env setup, aimed at someone who has never seen a terminal.
// Asks for the Atlas connection string, proves it works before saving, and
// lets them pick the database from a list instead of typing a name.
import { writeFileSync, chmodSync, existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { MongoClient } from "mongodb";

import { ask } from "../src/prompts.js";
import { COLLECTION_NAMES } from "../src/config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");
const CONNECT_OPTIONS = { serverSelectionTimeoutMS: 15000 };

// Atlas hands out "mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/..."
const URI_PATTERN = /^mongodb(\+srv)?:\/\/.+/;

function redact(uri) {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:••••••@");
}

async function promptUri() {
  while (true) {
    const answer = (
      await ask(
        "\nPaste your MongoDB connection string.\n" +
          "  In Atlas: Database → Connect → Drivers, then copy the string.\n" +
          "  It starts with mongodb+srv:// and contains your password.\n\n" +
          "Connection string: "
      )
    ).trim();

    if (!answer) {
      console.error("Nothing pasted. Try again, or press Ctrl-C to quit.");
      continue;
    }
    if (!URI_PATTERN.test(answer)) {
      console.error(
        "That doesn't look like a connection string — it should start with " +
          "mongodb+srv:// or mongodb://"
      );
      continue;
    }
    if (answer.includes("<password>") || answer.includes("<db_password>")) {
      console.error(
        "The string still has the <password> placeholder in it. Replace that " +
          "with your actual database password, then paste it again."
      );
      continue;
    }

    return answer;
  }
}

async function connect(uri) {
  const client = new MongoClient(uri, CONNECT_OPTIONS);
  process.stdout.write("Checking the connection… ");
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("connected.");
    return client;
  } catch (error) {
    console.log("failed.");
    console.error(`  ${error.message.split("\n")[0]}`);
    console.error(
      "\nCommon causes: the password is wrong, or your current network isn't " +
        "on the cluster's IP access list (Atlas → Network Access)."
    );
    await client.close().catch(() => {});
    return null;
  }
}

async function pickDatabase(client) {
  const { databases } = await client.db().admin().listDatabases();
  const usable = databases.filter(
    (d) => !["admin", "local", "config"].includes(d.name)
  );

  if (!usable.length) {
    console.error("No databases found on that cluster.");
    return null;
  }

  // Score each database by how much of the expected schema it has, so the
  // obvious one can be picked automatically.
  const scored = [];
  for (const { name } of usable) {
    const names = (await client.db(name).listCollections().toArray()).map(
      (c) => c.name
    );
    const matches = COLLECTION_NAMES.filter((c) => names.includes(c));
    scored.push({ name, matches });
  }

  const exact = scored.filter((d) => d.matches.length === COLLECTION_NAMES.length);
  if (exact.length === 1) {
    console.log(`\nFound the database: ${exact[0].name}`);
    return exact[0].name;
  }

  console.log("\nWhich database should be cleaned up?");
  scored.forEach((d, i) => {
    const detail = d.matches.length
      ? `has ${d.matches.join(", ")}`
      : "none of the expected collections";
    console.log(`  ${i + 1}) ${d.name} — ${detail}`);
  });

  while (true) {
    const answer = (await ask("Enter a number: ")).trim();
    const choice = scored[Number(answer) - 1];
    if (choice) return choice.name;
    console.error(`Pick a number between 1 and ${scored.length}.`);
  }
}

async function main() {
  console.log("Setting up the MongoDB cleanup tool.");

  if (existsSync(ENV_PATH)) {
    const current = readFileSync(ENV_PATH, "utf8");
    const dbName = current.match(/^DB_NAME=(.*)$/m)?.[1] ?? "unknown";
    const answer = (
      await ask(
        `\nAlready set up for database "${dbName}".\n` +
          "Set it up again with a different connection? [y/N]: "
      )
    ).trim().toLowerCase();

    if (answer !== "y" && answer !== "yes") {
      console.log("Keeping the existing settings.");
      return;
    }
  }

  while (true) {
    const uri = await promptUri();
    const client = await connect(uri);

    if (!client) {
      const retry = (await ask("\nTry a different connection string? [Y/n]: "))
        .trim()
        .toLowerCase();
      if (retry === "n" || retry === "no") process.exit(1);
      continue;
    }

    try {
      const dbName = await pickDatabase(client);
      if (!dbName) process.exit(1);

      writeFileSync(ENV_PATH, `MONGO_URI=${uri}\nDB_NAME=${dbName}\n`);
      chmodSync(ENV_PATH, 0o600); // it holds a database password

      console.log(`\nSaved to ${ENV_PATH}`);
      console.log(`  Cluster:  ${redact(uri)}`);
      console.log(`  Database: ${dbName}`);
      return;
    } finally {
      await client.close();
    }
  }
}

await main();
