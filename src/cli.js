#!/usr/bin/env node

const { generateNotes } = require("./notes");
const { INPUTS } = require("./options");

const USAGE = `Usage: drelease [options]

Generate nightly Markdown notes locally without fetching or publishing.

Options:
  --working-directory DIR  Repository to read (default: current directory).
  --ref REF                Commit or branch whose history to read (default: HEAD).
  --tag TAG                Nightly tag excluded from baseline selection (default: dev).
  --tag-pattern REGEX      Eligible version tags (default: ^v?[0-9]+(\\.[0-9]+)*$).
  --base-tag TAG           Explicit baseline tag instead of automatic selection.
  --since DATE             ISO 8601 start date overriding the baseline tag date.
  --until DATE             Inclusive ISO 8601 end date.
  --additional-notes TEXT  Extra Markdown before the commit list.
  --additional-notes-file FILE
                           Extra Markdown file relative to the repository.
  --notes-path FILE        Output file (default: releases/dev.md).
  --body-mode MODE         Print auto section (auto) or entire notes file (file).
  -h, --help               Show this help.
`;

function parseArgs(argv) {
  const options = { mode: "notes" };
  const names = new Map(INPUTS.filter(([name]) =>
    !["mode", "title", "recreate-release"].includes(name)).map(([name, key]) => [`--${name}`, key]));
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      options.help = true;
      continue;
    }
    const key = names.get(argument);
    if (!key) throw new Error(`unknown option: ${argument}`);
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    options[key] = argv[++index];
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const { body, outputs } = generateNotes(options);
  process.stdout.write(body);
  process.stderr.write(`Wrote ${outputs["notes-path"]}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, main };
