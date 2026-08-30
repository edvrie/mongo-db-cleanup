import { stdin } from "process";
import { MongoClient } from "mongodb";

import { COLLECTION_NAMES, DATE_FIELD, loadEnv } from "./src/config.js";
import { deleteMatching, dryRun, olderThan } from "./src/mongo.js";
import { plural, report } from "./src/format.js";
import { confirm, promptCutoffDate, promptSelection } from "./src/prompts.js";
import { checklist } from "./src/checklist.js";

async function main() {
  const { uri, dbName } = loadEnv();
  const client = new MongoClient(uri);

  try {
    const cutoff = (await promptCutoffDate()).toISOString();
    const query = olderThan(cutoff);

    await client.connect();
    const db = client.db(dbName);

    console.log(`\nDry run — documents with ${DATE_FIELD} before ${cutoff}`);
    const results = [];
    for (const name of COLLECTION_NAMES) {
      const result = await dryRun(db, name, query);
      report(result);
      results.push(result);
    }

    const candidates = results.filter((r) => r.doomed > 0);
    if (!candidates.length) {
      console.log("\nNothing to delete.");
      return;
    }

    console.log("");
    const selected = stdin.isTTY
      ? await checklist(candidates)
      : await promptSelection(candidates);

    if (!selected.length) {
      console.log("\nNothing selected, no documents were deleted.");
      return;
    }

    const totalDoomed = selected.reduce((sum, c) => sum + c.doomed, 0);
    const confirmed = await confirm(
      `\nPermanently delete ${plural(totalDoomed, "document")} from ` +
        `${selected.map((c) => c.name).join(", ")}? Type "yes" to confirm: `
    );

    if (!confirmed) {
      console.log("Aborted, no documents were deleted.");
      return;
    }

    for (const { name } of selected) {
      const deleted = await deleteMatching(db, name, query);
      console.log(`${name}: deleted ${plural(deleted, "document")}`);
    }
  } finally {
    await client.close();
  }
}

// `mongo-cleanup --setup` re-runs the connection wizard, so a non-technical
// user never has to find the install directory to change databases.
if (process.argv.includes("--setup")) {
  await import("./scripts/setup.js");
} else if (process.argv.includes("--help")) {
  console.log(
    "mongo-cleanup — delete old documents from the Nightscout database\n\n" +
      "  mongo-cleanup           clean up (asks before deleting anything)\n" +
      "  mongo-cleanup --setup   change which database to connect to\n" +
      "  mongo-cleanup --help    show this message"
  );
} else {
  await main();
}
