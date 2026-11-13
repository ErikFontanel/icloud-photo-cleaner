#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): formats the edited file and sends remaining lint errors back to the agent.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const { tool_input: input = {} } = JSON.parse(readFileSync(0, "utf8") || "{}");
const abs = resolve(input.file_path ?? "");
const file = relative(root, abs);

const run = (cmd, args, cwd = root) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return r.status === 0 ? "" : `$ ${cmd} ${args.join(" ")}\n${r.stdout}${r.stderr}`.trim();
};

let errors = "";
if (file.endsWith(".swift")) {
  run("xcrun", ["swift-format", "format", "-i", abs]);
  errors = run("xcrun", ["swift-format", "lint", "--strict", abs]);
} else if (/^mac\/.*\.py$/.test(file)) {
  const mac = resolve(root, "mac");
  run(".venv/bin/ruff", ["format", abs], mac);
  errors = run(".venv/bin/ruff", ["check", "--fix", "--output-format=concise", abs], mac);
} else if (/^mac\/sift_mac\/web\/.*\.(js|css|html)$/.test(file)) {
  errors = run("./node_modules/.bin/biome", ["check", "--write", "--colors=off", abs]);
} else if (file === "project.yml") {
  errors = run("scripts/generate.sh", []);
}

if (errors) {
  process.stdout.write(JSON.stringify({ decision: "block", reason: `Fix these errors in ${file} (the file is already formatted):\n${errors.slice(0, 4000)}` }));
}
