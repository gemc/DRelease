#!/usr/bin/env node

const { generateNotes } = require("./notes");
const { createGitHub, publishRelease } = require("./github");
const { INPUTS, normalizeOptions } = require("./options");
const { appendSummary, getInput, setOutput } = require("./utils");

async function main() {
  const options = normalizeOptions(Object.fromEntries(
    INPUTS.map(([name, key, fallback]) => [key, getInput(name, fallback)]),
  ));
  const api = options.mode === "release" ? createGitHub({
    token: getInput("token", process.env.GITHUB_TOKEN || ""),
    repository: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  }) : null;
  const { body, outputs } = generateNotes(options);
  if (api) outputs["release-url"] = await publishRelease(api, options, outputs["target-sha"], body);
  for (const [name, value] of Object.entries(outputs)) setOutput(name, value);
  const link = outputs["release-url"] ? `\n\n[Open nightly release](${outputs["release-url"]})` : "";
  appendSummary(`## DRelease ${options.mode}\n\n${body}${link}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`::error::${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
