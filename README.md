# DRelease

DRelease publishes a nightly prerelease with commit notes since the latest version tag. Each repository
calling it keeps its own schedule, nightly tag, and release. It replaces the repeated notes-generation,
tag-update, and publication steps used by GEMC, pygemc, and CLAS12 systems.

Use the root Action `gemc/DRelease@main`, the reusable workflow, or the local `./drelease` command to
generate the same notes. The initial version is **upcoming in the next release**; use `main` once the
implementation is published there, or pin a reviewed commit SHA.

## Prerequisites

- A Git repository checked out with full history and tags; in Actions, set `fetch-depth: 0`.
- A GitHub token with `contents: write` permission for publication.
- Node.js 24+ and Git for local use. The Bash launcher works on Linux and macOS; use WSL on Windows.

DRelease has no npm dependencies or build step. The Action supplies its own Node.js 24 runtime.

## Quickstart: try it in GitHub Actions

Save this as `.github/workflows/dev_release.yml` in your repository:

```yaml
name: Nightly Dev Release
on:
  schedule:
    - cron: '44 1 * * *'
  workflow_dispatch:
permissions:
  contents: write
concurrency:
  group: drelease-dev
  cancel-in-progress: false
jobs:
  dev-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: gemc/DRelease@main
        with:
          additional-notes: |
            Upcoming in the next release. This nightly build may change without notice.
```

Run the workflow from **Actions → Nightly Dev Release → Run workflow**, or let its schedule run nightly.
The action creates or moves the `dev` tag to the selected commit and publishes a prerelease. Publication
uses the GitHub API; no Git push or `gh` is needed. Each run includes its notes in the job summary.

The snippet matches GEMC's schedule and title. To preserve the other callers' settings:

- **pygemc:** use cron `34 1 * * *` and set `recreate-release: 'true'`.
- **CLAS12 systems:** set `title: CLAS12 Systems Dev Nightly` and `body-mode: file`.

Normal updates preserve release assets. Recreating a release deletes its assets and changes its release ID.
The notes file stays in the runner's working tree; no commit is created.

<br/>

## Reusable workflow

For a shorter caller, replace the `dev-release` job above with:

```yaml
jobs:
  dev-release:
    uses: gemc/DRelease/.github/workflows/dev-release.yml@main
    with:
      title: Dev Nightly
      additional-notes: Upcoming in the next release.
```

The reusable workflow handles checkout, tag-specific concurrency, and publication. Keep the schedule,
manual trigger, and `contents: write` permission in the caller. It accepts the release settings below;
`recreate-release` is a boolean here, and `ref` defaults to the caller's commit. Pass a custom token through
`secrets: {token: '${{ secrets.RELEASE_TOKEN }}'}` when needed. It exposes the same outputs as the Action;
its notes path belongs to the remote job's runner.

<br/>

## Quickstart: preview locally

From the DRelease checkout, generate notes for another repository without fetching or publishing:

```shell
./drelease --working-directory /path/to/your/repository --notes-path /tmp/nightly-notes.md
```

The command prints the release body and writes the notes file. Use `./drelease --help` for options.
The local CLI always previews; release publication is performed by the Action's `release` mode.

<br/>

## Commit range

The default baseline is the most recently created version tag matching `^v?[0-9]+(\.[0-9]+)*$`, excluding
the moving nightly tag. Annotated tags use their tagger date; lightweight tags use their commit date.
Selection is by date, not version number. Set `tag-pattern` for other naming schemes, or `base-tag` to
choose an existing tag explicitly.

Notes contain every commit reachable from the selected ref whose committer timestamp is strictly after
the baseline date, including merge commits. Displayed dates use UTC. The baseline commit and older commits
brought in by a merge are excluded by their timestamps. With no matching tags, notes include the full
reachable history. Shallow checkouts fail with instructions to obtain complete history.

`since` overrides the baseline date; `until` provides an inclusive upper bound. Both accept ISO 8601 dates
or timestamps; values without a timezone use UTC. No fixed date needs updating after each version tag.
Existing `DEVMD_SINCE` and `DEVMD_UNTIL` variables are replaced by these inputs.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `mode` | `release` | Publish a release, or `notes` to generate notes without network access. |
| `working-directory` | `.` | Checked-out repository to read. |
| `token` | `${{ github.token }}` | Token for publication; not used in notes mode. |
| `tag` | `dev` | Moving nightly tag; use a dedicated tag, never a stable release tag. |
| `title` | `Dev Nightly` | Release title. |
| `ref` | `HEAD` | Existing commit or branch in the checkout to release. |
| `tag-pattern` | Version pattern above | JavaScript regular expression matched against entire tag names. |
| `base-tag` | Automatic | Explicit baseline tag. |
| `since` | Baseline tag date | Override the start date. |
| `until` | No limit | Inclusive end date for the notes. |
| `additional-notes` | Empty | Extra Markdown before the commit list; supports multiline text. |
| `additional-notes-file` | Empty | Extra Markdown file relative to the checked-out repository. |
| `notes-path` | `releases/dev.md` | Generated notes file, relative to the repository or absolute. |
| `body-mode` | `auto` | Publish the generated section, or `file` for the entire notes file. |
| `recreate-release` | `'false'` | Set `'true'` to delete and recreate an existing nightly release. |

Notes replace the region between `<!-- AUTO-DEVMD:START -->` and `<!-- AUTO-DEVMD:END -->`, preserving text
outside it. Files without markers get a new generated section appended. Malformed markers fail instead
of overwriting content. Inline notes and notes read from a file are included before the commit list.

Outputs: `base-tag`, `since`, `target-sha`, `notes-path` (absolute), and `release-url` (release mode only).

<br/>

## Development

Like Callgrinder and ThreadScale, DRelease uses CommonJS modules under `src/`, thin Action and CLI entry
points, and native Node tests under `test/`. Shared code implements notes generation and publication.

```shell
npm run check   # node --check on the entry points
npm test        # node --test; temporary repositories and mocked GitHub API responses
```

Simulate the Action locally with `INPUT_*` variables, as in the other projects:

```shell
INPUT_MODE=notes node src/main.js
```

That writes the default notes file in the current repository; use the CLI's `--notes-path` option to
preview in a scratch path. Both test commands work offline, with no install step.
See [v1.0.0 release notes](releases/v1.0.0.md) for the upcoming initial version.
# DRelease
