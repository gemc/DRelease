// Shared defaults keep the Action and local CLI consistent.
const INPUTS = [
  ["mode", "mode", "release"],
  ["working-directory", "workingDirectory", "."],
  ["tag", "tag", "dev"],
  ["title", "title", "Dev Nightly"],
  ["ref", "ref", "HEAD"],
  ["tag-pattern", "tagPattern", "^v?[0-9]+(\\.[0-9]+)*$"],
  ["base-tag", "baseTag", ""],
  ["since", "since", ""],
  ["until", "until", ""],
  ["additional-notes", "additionalNotes", ""],
  ["additional-notes-file", "additionalNotesFile", ""],
  ["notes-path", "notesPath", "releases/dev.md"],
  ["body-mode", "bodyMode", "auto"],
  ["recreate-release", "recreateRelease", "false"],
];

function normalizeOptions(options = {}) {
  const normalized = { ...Object.fromEntries(INPUTS.map(([, key, value]) => [key, value])), ...options };
  if (!["notes", "release"].includes(normalized.mode)) {
    throw new Error("mode must be notes or release");
  }
  if (!["auto", "file"].includes(normalized.bodyMode)) {
    throw new Error("body-mode must be auto or file");
  }
  if (![true, false, "true", "false"].includes(normalized.recreateRelease)) {
    throw new Error("recreate-release must be true or false");
  }
  normalized.recreateRelease = normalized.recreateRelease === true || normalized.recreateRelease === "true";
  return normalized;
}

module.exports = { INPUTS, normalizeOptions };
