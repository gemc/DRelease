const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { normalizeOptions } = require("./options");

const START = "<!-- AUTO-DEVMD:START -->";
const END = "<!-- AUTO-DEVMD:END -->";

function git(repository, ...args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  }).trimEnd();
}

function parseDate(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/,
  );
  if (!match) throw new Error(`Expected an ISO 8601 date or timestamp; received ${value}`);
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days
      || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    throw new Error(`Invalid ISO 8601 date: ${value}`);
  }
  const normalized = value.length === 10 ? `${value}T00:00:00Z` : value + (match[7] ? "" : "Z");
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ISO 8601 date: ${value}`);
  return Math.floor(timestamp / 1000);
}

function utcDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().replace(".000Z", "Z");
}

function selectBaseline(repository, options) {
  const pattern = new RegExp(options.tagPattern);
  const raw = git(repository, "for-each-ref", "--sort=-creatordate",
    "--format=%(refname:strip=2)%09%(creatordate:unix)", "refs/tags");
  const tags = raw ? raw.split("\n").map((line) => {
    const [tag, timestamp] = line.split("\t");
    return { tag, timestamp: Number(timestamp) };
  }) : [];
  let selected;
  if (options.baseTag) {
    selected = tags.find(({ tag }) => tag === options.baseTag && tag !== options.tag);
    if (!selected) throw new Error("base-tag must name an existing tag other than the nightly tag");
  } else {
    selected = tags.find(({ tag }) => tag !== options.tag && pattern.exec(tag)?.[0] === tag);
  }
  return selected || { tag: "", timestamp: null };
}

function replaceAutoSection(original, section) {
  const auto = `${START}\n${section}${END}`;
  let updated;
  if (original.includes(START) || original.includes(END)) {
    if (original.split(START).length !== 2 || original.split(END).length !== 2) {
      throw new Error("notes file must contain exactly one pair of AUTO-DEVMD markers");
    }
    const start = original.indexOf(START);
    const end = original.indexOf(END);
    if (end < start) throw new Error("AUTO-DEVMD markers are out of order");
    updated = original.slice(0, start) + auto + original.slice(end + END.length);
  } else {
    updated = `${original.trimEnd()}\n\n${auto}\n`;
  }
  return { auto: `${auto}\n`, updated };
}

function generateNotes(input = {}) {
  const options = normalizeOptions(input);
  const repository = path.resolve(options.workingDirectory);
  git(repository, "check-ref-format", `refs/tags/${options.tag}`);
  if (git(repository, "rev-parse", "--is-shallow-repository") === "true") {
    throw new Error("Full history and tags are required; use actions/checkout with fetch-depth: 0");
  }
  const sha = git(repository, "rev-parse", "--verify", "--end-of-options", `${options.ref}^{commit}`);
  const baseline = selectBaseline(repository, options);
  const cutoff = options.since ? parseDate(options.since) : baseline.timestamp;
  const until = options.until ? parseDate(options.until) : null;
  if (cutoff !== null && until !== null && until < cutoff) throw new Error("until must not precede since");

  // Scan the entire reachable history, including ancestors with non-monotonic dates.
  const raw = git(repository, "log", "--no-show-signature", "-z", "--format=%ct%x00%h%x00%s%x00%an", sha);
  const values = raw.split("\0");
  const commits = [];
  for (let index = 0; index + 3 < values.length; index += 4) {
    const [seconds, shortSha, subject, author] = values.slice(index, index + 4);
    const timestamp = Number(seconds);
    if ((cutoff !== null && timestamp <= cutoff) || (until !== null && timestamp > until)) continue;
    commits.push(`- ${utcDate(timestamp).slice(0, 10)} **${shortSha}** — ${subject} _(by ${author})_`);
  }
  let heading = `## Commits at ${sha.slice(0, 7)}`;
  if (cutoff !== null) heading += ` since ${utcDate(cutoff)}`;
  if (until !== null) heading += ` until ${utcDate(until)}`;
  const sections = [];
  if (baseline.tag) sections.push(`Baseline tag: \`${baseline.tag}\`.`);
  if (options.additionalNotes.trim()) sections.push(options.additionalNotes.trim());
  if (options.additionalNotesFile) {
    sections.push(fs.readFileSync(path.resolve(repository, options.additionalNotesFile), "utf8").trim());
  }
  sections.push(`${heading}\n\n${(commits.length ? commits : ["- (no commits in range)"]).join("\n")}`);
  const notesPath = path.resolve(repository, options.notesPath);
  const original = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf8") : "# Dev Release Notes\n";
  const result = replaceAutoSection(original, `${sections.join("\n\n")}\n`);
  fs.mkdirSync(path.dirname(notesPath), { recursive: true });
  fs.writeFileSync(notesPath, result.updated, "utf8");
  return {
    body: options.bodyMode === "file" ? result.updated : result.auto,
    outputs: {
      "base-tag": baseline.tag,
      since: cutoff === null ? "" : utcDate(cutoff),
      "target-sha": sha,
      "notes-path": notesPath,
    },
  };
}

module.exports = { generateNotes, git, parseDate, replaceAutoSection, selectBaseline, utcDate };
