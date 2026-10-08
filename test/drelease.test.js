const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { generateNotes, parseDate } = require("../src/notes");
const { normalizeOptions } = require("../src/options");
const { createGitHub, publishRelease } = require("../src/github");
const { parseArgs } = require("../src/cli");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "drelease-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  function git(args, date, input) {
    const env = { ...process.env };
    if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", env, input }).trim();
  }
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "Tester"]);
  git(["config", "user.email", "tester@example.invalid"]);
  function commit(subject, date, parents) {
    const ref = path.join(directory, ".git/refs/heads/main");
    parents ??= fs.existsSync(ref) ? [fs.readFileSync(ref, "utf8").trim()] : [];
    const tree = git(["write-tree"]);
    const args = ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])];
    const sha = git(args, date, `${subject}\n`);
    git(["update-ref", "refs/heads/main", sha]);
    return sha;
  }
  function notes(options = {}) {
    return generateNotes({ workingDirectory: directory, ...options });
  }
  return { directory, git, commit, notes };
}

test("latest version tag is selected by date and excludes the nightly tag", (t) => {
  const repo = fixture(t);
  repo.commit("Old", "2026-10-01T12:00:00Z");
  repo.git(["tag", "v9.0"]);
  repo.commit("Version", "2026-10-02T12:00:00Z");
  repo.git(["tag", "v1.0"]);
  const sha = repo.commit("New", "2026-10-03T12:00:00Z");
  repo.git(["tag", "dev"]);
  repo.git(["tag", "unrelated"]);
  const { body, outputs } = repo.notes();
  assert.equal(outputs["base-tag"], "v1.0");
  assert.equal(outputs["target-sha"], sha);
  assert.match(body, /New _\(by Tester\)_/);
  assert.doesNotMatch(body, /(?:Old|Version) _\(by Tester\)_/);
});

test("annotated tags use tagger dates", (t) => {
  const repo = fixture(t);
  repo.commit("Tagged commit", "2026-10-01T12:00:00Z");
  repo.git(["tag", "-a", "0.4", "-m", "Release"], "2026-10-03T12:00:00Z");
  repo.commit("Before tag date", "2026-10-02T12:00:00Z");
  repo.commit("After tag date", "2026-10-04T12:00:00Z");
  const { body, outputs } = repo.notes();
  assert.equal(outputs.since, "2026-10-03T12:00:00Z");
  assert.doesNotMatch(body, /Before tag date _\(by Tester\)_/);
  assert.match(body, /After tag date _\(by Tester\)_/);
});

test("non-monotonic dates and merge parents retain every eligible commit", (t) => {
  const repo = fixture(t);
  const base = repo.commit("Release", "2026-10-02T12:00:00Z");
  repo.git(["tag", "0.1"]);
  const left = repo.commit("New ancestor", "2026-10-04T12:00:00Z");
  const right = repo.commit("Other branch", "2026-10-03T12:00:00Z", [base]);
  repo.commit("Backdated merge", "2026-10-01T12:00:00Z", [left, right]);
  const { body } = repo.notes();
  assert.match(body, /New ancestor _\(by Tester\)_/);
  assert.match(body, /Other branch _\(by Tester\)_/);
  assert.doesNotMatch(body, /Backdated merge _\(by Tester\)_/);
});

test("untagged and detached repositories use full history", (t) => {
  const repo = fixture(t);
  const sha = repo.commit("First", "2026-10-01T12:00:00Z");
  repo.git(["checkout", "-q", "--detach", sha]);
  const { body, outputs } = repo.notes();
  assert.equal(outputs["base-tag"], "");
  assert.equal(outputs.since, "");
  assert.match(body, /First _\(by Tester\)_/);
});

test("explicit refs select the target without changing HEAD", (t) => {
  const repo = fixture(t);
  const target = repo.commit("Target", "2026-10-01T12:00:00Z");
  const head = repo.commit("Later", "2026-10-02T12:00:00Z");
  const { body, outputs } = repo.notes({ ref: target });
  assert.equal(outputs["target-sha"], target);
  assert.match(body, /Target _\(by Tester\)_/);
  assert.doesNotMatch(body, /Later _\(by Tester\)_/);
  assert.equal(repo.git(["rev-parse", "HEAD"]), head);
});

test("date overrides and custom tag patterns apply inclusive upper bounds", (t) => {
  const repo = fixture(t);
  repo.commit("Release", "2026-10-01T12:00:00Z");
  repo.git(["tag", "release-1"]);
  repo.commit("Included", "2026-10-02T12:00:00Z");
  repo.commit("Too late", "2026-10-04T12:00:00Z");
  const { body, outputs } = repo.notes({
    tagPattern: "release-\\d+", since: "2026-10-02", until: "2026-10-02T14:00:00+02:00",
  });
  assert.equal(outputs["base-tag"], "release-1");
  assert.match(body, /Included _\(by Tester\)_/);
  assert.doesNotMatch(body, /Too late _\(by Tester\)_/);
});

test("ISO dates use UTC and invalid values fail", () => {
  assert.equal(parseDate("2026-10-02"), parseDate("2026-10-02T00:00:00Z"));
  assert.equal(parseDate("2026-10-02T12:00:00"), parseDate("2026-10-02T12:00:00Z"));
  for (const value of ["bad", "2026-02-30", "2026-13-01", "2026-10-02T25:00:00Z"]) {
    assert.throws(() => parseDate(value), /ISO 8601/);
  }
});

test("manual text and additional notes are preserved across repeat generation", (t) => {
  const repo = fixture(t);
  repo.commit("First", "2026-10-01T12:00:00Z");
  const notesPath = path.join(repo.directory, "notes.md");
  fs.writeFileSync(notesPath, "Manual introduction\n<!-- AUTO-DEVMD:START -->\nold\n"
    + "<!-- AUTO-DEVMD:END -->\nManual footer\n");
  fs.writeFileSync(path.join(repo.directory, "extra.md"), "From a file\n");
  const options = { notesPath: "notes.md", additionalNotes: "Inline notes", additionalNotesFile: "extra.md" };
  const { body } = repo.notes(options);
  const saved = fs.readFileSync(notesPath, "utf8");
  repo.notes(options);
  assert.equal(fs.readFileSync(notesPath, "utf8"), saved);
  assert.match(saved, /^Manual introduction/);
  assert.match(saved, /Manual footer\n$/);
  assert.match(body, /Inline notes\n\nFrom a file/);
  assert.doesNotMatch(body, /Manual introduction/);
  assert.equal(repo.notes({ ...options, bodyMode: "file" }).body, saved);
});

test("missing markers append and malformed markers fail without overwriting", (t) => {
  const repo = fixture(t);
  repo.commit("First", "2026-10-01T12:00:00Z");
  const notesPath = path.join(repo.directory, "notes.md");
  fs.writeFileSync(notesPath, "Existing manual notes\n");
  repo.notes({ notesPath });
  assert.match(fs.readFileSync(notesPath, "utf8"), /^Existing manual notes/);
  for (const content of ["<!-- AUTO-DEVMD:START -->\n",
    "<!-- AUTO-DEVMD:END -->\n<!-- AUTO-DEVMD:START -->\n"]) {
    fs.writeFileSync(notesPath, content);
    assert.throws(() => repo.notes({ notesPath }), /AUTO-DEVMD/);
    assert.equal(fs.readFileSync(notesPath, "utf8"), content);
  }
});

test("explicit baselines, empty ranges, and invalid configuration", (t) => {
  const repo = fixture(t);
  repo.commit("First", "2026-10-01T12:00:00Z");
  repo.git(["tag", "custom"]);
  repo.git(["tag", "dev"]);
  assert.match(repo.notes({ baseTag: "custom" }).body, /no commits in range/);
  for (const baseTag of ["missing", "dev"]) assert.throws(() => repo.notes({ baseTag }), /base-tag/);
  assert.throws(() => repo.notes({ mode: "bad" }), /mode/);
  assert.throws(() => repo.notes({ bodyMode: "bad" }), /body-mode/);
  assert.throws(() => repo.notes({ recreateRelease: "bad" }), /recreate-release/);
  assert.throws(() => repo.notes({ since: "2026-10-02", until: "2026-10-01" }), /until/);
});

test("shallow checkouts fail instead of publishing incomplete notes", (t) => {
  const repo = fixture(t);
  const sha = repo.commit("First", "2026-10-01T12:00:00Z");
  fs.writeFileSync(path.join(repo.directory, ".git/shallow"), `${sha}\n`);
  assert.throws(() => repo.notes(), /fetch-depth: 0/);
});

function mockApi(responses) {
  const calls = [];
  return {
    calls,
    async request(...args) {
      calls.push(args);
      assert.ok(responses.length, "Unexpected API request");
      return responses.shift();
    },
  };
}

test("publication creates a moving tag and prerelease without marking it latest", async () => {
  const api = mockApi([null, {}, null, { html_url: "https://example.invalid/release" }]);
  assert.equal(await publishRelease(api, normalizeOptions(), "abc123", "Notes"),
    "https://example.invalid/release");
  assert.deepEqual(api.calls[1], ["POST", "/git/refs", { ref: "refs/tags/dev", sha: "abc123" }]);
  assert.equal(api.calls[3][0], "POST");
  assert.equal(api.calls[3][2].prerelease, true);
  assert.equal(api.calls[3][2].make_latest, "false");
});

test("updates preserve the existing release and force the nightly ref", async () => {
  const api = mockApi([{ ref: "ref" }, {}, { id: 42 }, { html_url: "url" }]);
  await publishRelease(api, normalizeOptions(), "abc123", "Notes");
  assert.deepEqual(api.calls[1], ["PATCH", "/git/refs/tags/dev", { sha: "abc123", force: true }]);
  assert.deepEqual(api.calls[3].slice(0, 2), ["PATCH", "/releases/42"]);
});

test("recreation deletes the existing release and encodes tag URLs", async () => {
  const api = mockApi([{ ref: "ref" }, {}, { id: 42 }, null, { html_url: "url" }]);
  const options = normalizeOptions({ tag: "nightly/dev", recreateRelease: "true" });
  await publishRelease(api, options, "abc123", "Notes");
  assert.equal(api.calls[0][1], "/git/ref/tags/nightly%2Fdev");
  assert.deepEqual(api.calls[3], ["DELETE", "/releases/42"]);
  assert.deepEqual(api.calls[4].slice(0, 2), ["POST", "/releases"]);
});

test("REST access sends credentials, supports enterprise URLs, and accepts only missing 404s", async () => {
  const requests = [];
  let status = 404;
  const api = createGitHub({
    token: "fake-token", repository: "owner/repo", apiUrl: "https://example.invalid/api/v3/",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(status === 204 ? null : "{}", { status });
    },
  });
  assert.equal(await api.request("GET", "/releases/tags/dev", undefined, true), null);
  assert.equal(requests[0].url, "https://example.invalid/api/v3/repos/owner/repo/releases/tags/dev");
  assert.equal(requests[0].options.headers.Authorization, "Bearer fake-token");
  status = 403;
  await assert.rejects(api.request("GET", "/releases/tags/dev", undefined, true), /HTTP 403/);
  status = 204;
  assert.equal(await api.request("DELETE", "/releases/42"), null);
  assert.throws(() => createGitHub({ token: "", repository: "owner/repo" }), /token/);
});

test("CLI parses shared options and rejects missing or unknown arguments", () => {
  assert.deepEqual(parseArgs(["--ref", "main", "--since", "2026-10-02"]),
    { mode: "notes", ref: "main", since: "2026-10-02" });
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs(["--ref"]), /requires a value/);
  assert.throws(() => parseArgs(["--publish"]), /unknown option/);
});

test("the local launcher previews another repository without changing HEAD", (t) => {
  const repo = fixture(t);
  const sha = repo.commit("Local preview", "2026-10-01T12:00:00Z");
  const filename = path.join(repo.directory, "preview.md");
  const result = spawnSync(path.resolve(__dirname, "../drelease"),
    ["--working-directory", repo.directory, "--notes-path", filename], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Local preview/);
  assert.ok(fs.existsSync(filename));
  assert.equal(repo.git(["rev-parse", "HEAD"]), sha);
});

test("notes-mode Action emits outputs and a job summary without credentials", (t) => {
  const repo = fixture(t);
  const sha = repo.commit("Action preview", "2026-10-01T12:00:00Z");
  const output = path.join(repo.directory, "outputs");
  const summary = path.join(repo.directory, "summary");
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "../src/main.js")], {
    cwd: repo.directory, encoding: "utf8",
    env: { ...process.env, INPUT_MODE: "notes", INPUT_TOKEN: "", GITHUB_TOKEN: "",
      "INPUT_NOTES-PATH": "action.md", GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(output, "utf8"), new RegExp(`target-sha<<[^\\n]+\\n${sha}\\n`));
  assert.match(fs.readFileSync(summary, "utf8"), /DRelease notes[\s\S]*Action preview/);
  assert.doesNotMatch(result.stdout, /release-url/);
});
