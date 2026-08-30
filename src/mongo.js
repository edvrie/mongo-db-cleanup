import { DATE_FIELD, PREVIEW_SIZE } from "./config.js";

// created_at is a UTC ISO string, so compare against a string, not a Date.
// $lt, not $lte: a document stamped exactly at the cutoff is kept.
export function olderThan(cutoff) {
  return { [DATE_FIELD]: { $lt: cutoff } };
}

export async function dryRun(db, name, query) {
  const collection = db.collection(name);

  const [total, doomed] = await Promise.all([
    collection.estimatedDocumentCount(),
    collection.countDocuments(query),
  ]);

  const oldest = await collection
    .find(query)
    .sort({ [DATE_FIELD]: 1 })
    .limit(PREVIEW_SIZE)
    .toArray();

  const newest = await collection
    .find(query)
    .sort({ [DATE_FIELD]: -1 })
    .limit(PREVIEW_SIZE)
    .toArray();

  return { name, total, doomed, oldest, newest: newest.reverse() };
}

export async function deleteMatching(db, name, query) {
  const { deletedCount } = await db.collection(name).deleteMany(query);
  return deletedCount;
}
