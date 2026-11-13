#!/usr/bin/env node
// PreToolUse (Edit|Write|MultiEdit): denies edits to the generated Xcode project and new code that deletes photos.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const { tool_input: input = {} } = JSON.parse(readFileSync(0, "utf8") || "{}");
const file = relative(root, resolve(input.file_path ?? ""));

const deny = (reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
  process.exit(0);
};

if (file.startsWith("Sift.xcodeproj/")) {
  deny("Sift.xcodeproj is generated and not in git. Edit project.yml, then run scripts/generate.sh.");
}

if (/\.(swift|py)$/.test(file)) {
  const text = [input.content, input.new_string, ...(input.edits ?? []).map((e) => e.new_string)].filter(Boolean).join("\n");
  try {
    execFileSync(`${root}/scripts/no-delete.sh`, ["-"], { input: text, stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    deny(`Sift never deletes photos (README, AGENTS.md). This edit calls a photo delete API:\n${e.stdout}Add photos to the To Delete album instead.`);
  }
}
