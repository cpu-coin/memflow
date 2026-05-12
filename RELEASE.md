# Release Process

## Versioning

MemFlow uses semantic versioning.

Examples:

- `1.0.0` first public stable release
- `1.0.1` small patch release
- `1.1.0` new feature release
- `2.0.0` future major release

## Update Version

```bash
npm run version:set -- 1.0.1
```

## Verify Release Candidate

```bash
NPM_CONFIG_CACHE=/tmp/memflow-npm-cache npm run release:check
```

This runs:

- package build
- full test suite
- package dry-run

## Git Tag Convention

Use annotated semver tags:

```bash
git tag -a v1.0.0 -m "MemFlow 1.0.0"
```

## GitHub Release

Recommended public release location:

- GitHub Releases on the public MemFlow repository, anchored to the matching semver tag.
- Use the release page for notes, assets, and version history.
- If MemFlow later ships an installable package, use npm as the distribution channel, but keep GitHub Releases as the canonical release record.

When the new public repo exists, create a GitHub release from the matching tag.

Recommended release title:

```text
MemFlow 1.0.0
```

Recommended release notes source:

- summarize from `CHANGELOG.md`
- mention testing/private-preview scope when applicable
- include CPUcoin / equilibrium.com attribution where appropriate
- keep MemFlow described as one spoke in the broader "The Hybrid Decentralized Cloud For AI" direction

## Runtime Version Display

Human-readable:

```bash
memflow version
```

Machine-readable:

```bash
memflow version --json
```

GitHub metadata can be surfaced automatically through:

- `GITHUB_REF_NAME`
- `GITHUB_SHA`
- `GITHUB_REPOSITORY`
