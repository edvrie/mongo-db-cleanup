import { createInterface } from "readline";
import { stdin, stdout } from "process";
import dayjs from "dayjs";

import { DATE_FORMAT, defaultCutoffDate } from "./config.js";

// Piped stdin hits EOF as soon as the first answer is read, which closes
// readline and makes every later question throw. So drain the pipe once and
// serve answers from the queue; an exhausted queue answers "" (the safe
// default at every prompt: keep the default date, select nothing, abort).
let pipedAnswers = null;

async function drainStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return chunks.join("").split("\n");
}

// One interface per question: the checklist puts stdin in raw mode, and a
// long-lived readline would fight it for keypresses.
export async function ask(query) {
  if (!stdin.isTTY) {
    pipedAnswers ??= await drainStdin();
    const answer = pipedAnswers.shift() ?? "";
    stdout.write(`${query}${answer}\n`);
    return answer;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

export async function promptCutoffDate() {
  const fallback = defaultCutoffDate();

  while (true) {
    const answer = (
      await ask(
        `Cutoff date (${DATE_FORMAT}) — everything before it gets deleted.\n` +
          `Press Enter for the default [${fallback.format(DATE_FORMAT)}]: `
      )
    ).trim();

    if (!answer) return fallback;

    const parsed = dayjs.utc(answer, DATE_FORMAT, true).startOf("day");
    if (!parsed.isValid()) {
      console.error(`Not a valid ${DATE_FORMAT} date: "${answer}"\n`);
      continue;
    }
    if (parsed.isAfter(dayjs())) {
      console.error("Cutoff date is in the future.\n");
      continue;
    }

    return parsed;
  }
}

// Fallback for non-interactive stdin (a pipe, CI), where raw mode is unavailable.
export async function promptSelection(candidates) {
  const menu = candidates
    .map((c, i) => `  ${i + 1}) ${c.name} (${c.doomed})`)
    .join("\n");

  while (true) {
    const answer = (
      await ask(
        `\nWhich collections should be cleaned up?\n${menu}\n` +
          `Enter "all", "none", or a comma-separated list of numbers/names: `
      )
    )
      .trim()
      .toLowerCase();

    if (!answer || answer === "none") return [];
    if (answer === "all") return candidates;

    const picked = [];
    const unknown = [];

    for (const token of answer.split(",").map((t) => t.trim()).filter(Boolean)) {
      const byIndex = Number(token);
      const match = Number.isInteger(byIndex)
        ? candidates[byIndex - 1]
        : candidates.find((c) => c.name === token);

      if (!match) unknown.push(token);
      else if (!picked.includes(match)) picked.push(match);
    }

    if (unknown.length) {
      console.error(`Not on the list: ${unknown.join(", ")}`);
      continue;
    }

    return picked;
  }
}

export async function confirm(query) {
  return (await ask(query)).trim() === "yes";
}
