import { emitKeypressEvents } from "readline";
import { stdin, stdout } from "process";

import { plural } from "./format.js";

const RUN = Symbol("run");
const CANCEL = Symbol("cancel");

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const bold = (text) => `\x1b[1m${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;

// Interactive multi-select over the collections that have something to delete.
// Resolves with the chosen candidates, or [] when cancelled.
export function checklist(candidates) {
  const rows = [
    ...candidates.map((c) => ({ type: "item", candidate: c })),
    { type: "action", action: RUN },
    { type: "action", action: CANCEL },
  ];
  const checked = new Set();
  let cursor = 0;
  let lines = 0;

  const render = () => {
    // Redraw in place: jump back over the previous frame and clear downward.
    if (lines) stdout.write(`\x1b[${lines}A\x1b[0J`);

    const selectedCount = [...checked].reduce(
      (sum, i) => sum + candidates[i].doomed,
      0
    );

    const out = ["Select the collections to clean up:"];
    rows.forEach((row, i) => {
      const active = i === cursor;
      const pointer = active ? cyan("❯") : " ";

      if (row.type === "item") {
        const box = checked.has(i) ? "[x]" : "[ ]";
        const label = `${row.candidate.name} (${plural(
          row.candidate.doomed,
          "document"
        )})`;
        out.push(`${pointer} ${box} ${active ? bold(label) : label}`);
        return;
      }

      const label =
        row.action === RUN
          ? `Run cleanup${selectedCount ? ` (${selectedCount})` : ""}`
          : "Cancel";
      out.push(`${pointer}     ${active ? bold(label) : label}`);
    });
    out.push(
      dim("↑/↓ move · space or enter toggles · a toggles all · enter on Run executes")
    );

    stdout.write(out.join("\n") + "\n");
    lines = out.length;
  };

  return new Promise((resolve) => {
    emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write(HIDE_CURSOR);

    const finish = (result) => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write(SHOW_CURSOR);
      resolve(result);
    };

    const onKeypress = (_, key) => {
      if (!key) return;

      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        finish([]);
        return;
      }

      switch (key.name) {
        case "up":
        case "k":
          cursor = (cursor - 1 + rows.length) % rows.length;
          break;
        case "down":
        case "j":
        case "tab":
          cursor = (cursor + 1) % rows.length;
          break;
        case "a": {
          const items = rows.flatMap((r, i) => (r.type === "item" ? i : []));
          const fill = checked.size < items.length;
          checked.clear();
          if (fill) items.forEach((i) => checked.add(i));
          break;
        }
        case "space":
        case "return": {
          const row = rows[cursor];
          if (row.type === "item") {
            if (checked.has(cursor)) checked.delete(cursor);
            else checked.add(cursor);
            break;
          }
          // Space on an action row shouldn't fire it; only enter does.
          if (key.name === "space") return;
          finish(
            row.action === RUN
              ? [...checked].sort((a, b) => a - b).map((i) => candidates[i])
              : []
          );
          return;
        }
        default:
          return;
      }

      render();
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}
