import { DATE_FIELD, PREVIEW_SIZE } from "./config.js";

export function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function previewLine(doc) {
  const { _id, [DATE_FIELD]: date, ...rest } = doc;
  const fields = JSON.stringify(rest);
  const summary = fields.length > 100 ? `${fields.slice(0, 99)}…` : fields;
  return `    ${date}  ${_id}  ${summary}`;
}

export function report({ name, total, doomed, oldest, newest }) {
  const kept = total - doomed;
  console.log(`\n${name}`);
  console.log(
    `  ${plural(total, "document")}, ${doomed} to delete, ${kept} to keep` +
      (total ? ` (${((doomed / total) * 100).toFixed(1)}%)` : "")
  );

  if (!doomed) return;

  // Up to 2x PREVIEW_SIZE the oldest and newest previews overlap, so list the
  // whole batch once instead of repeating documents under two headings.
  if (doomed <= PREVIEW_SIZE * 2) {
    console.log(`  ${plural(doomed, "document")} to be deleted:`);
    [...oldest, ...newest]
      .filter((doc, i, all) => all.findIndex((d) => d._id === doc._id) === i)
      .sort((a, b) => a[DATE_FIELD].localeCompare(b[DATE_FIELD]))
      .forEach((doc) => console.log(previewLine(doc)));
    return;
  }

  console.log(`  oldest ${PREVIEW_SIZE} to be deleted:`);
  oldest.forEach((doc) => console.log(previewLine(doc)));
  console.log(`  newest ${PREVIEW_SIZE} to be deleted:`);
  newest.forEach((doc) => console.log(previewLine(doc)));
}
