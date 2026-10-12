# Contributing to K-Doc

Thank you for helping. This page explains how to get the project running, how changes are proposed, and the
conventions the code follows. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

K-Doc builds on **Windows 10 or 11**. You need Node.js 22 or later and a stable Rust toolchain (rustup). The
[README](README.md#run-from-source) lists the prerequisites in full.

```bash
npm install
```

```bash
npm run tauri dev
```

[DESIGN.md](DESIGN.md) describes how the pieces fit together; read the section for the area you are changing first.

## Proposing a change

1. Open an issue for anything larger than a small fix, so the approach can be agreed before you write it.
2. Work on a branch named for the change: `feat/<slug>`, `fix/<slug>` or `chore/<slug>`.
3. Write commits as [Conventional Commits](https://www.conventionalcommits.org/) (`feat(editor): Add …`,
   `fix(files): Keep …`), in the imperative.
4. Add a bullet for your change under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), and update
   [DESIGN.md](DESIGN.md) when the change alters the architecture (a new module, command, data flow or dependency).
5. Open a pull request describing what changed, why, and how you tested it. CI must pass.

Report security problems privately as described in [SECURITY.md](SECURITY.md), not in a pull request or issue.

## Tests

Every change ships with tests. TypeScript uses Vitest; the Rust host uses `cargo test`.

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run test:rust
```

The Markdown round-trip suite (`npm run test:roundtrip`) is the project's core contract: untouched parts of a file
must be written back byte for byte. A change that makes a round-trip test fail is a bug in the change.

## Code conventions

- **TypeScript** is strict: no `any` (use `unknown` and narrow), no `@ts-ignore`, and validated data at every
  boundary (IPC payloads, settings files, plugin messages).
- **Rust**: no `unwrap`/`expect` outside tests, no `unsafe`, every command validates its arguments, and subprocesses
  are started with argument arrays, never through a shell.
- **Comments** follow a deliberate, documentation-heavy house style:
  - every file starts with a header block (`@file`, `@purpose`, `@inputs`, `@outputs`, `@functions`, `@dataflow`,
    `@controlflow`, `@version`, `@date`), and every function has a matching block;
  - every `if`/`else`, `switch` case and guard clause has a comment saying what it checks and what each branch does
    (including an `else` that only holds a comment);
  - bump a file's `@version` and `@date` when you change it.

  It is unusual, but it is consistent across the codebase, so please keep to it.
- Keep user-facing text plain and specific: say what happened and what the user can do next.

## Licensing

K-Doc is licensed under Apache-2.0. By submitting a contribution you agree that it is licensed under the same terms
(section 5 of the [licence](LICENSE)). New third-party dependencies must have a licence compatible with Apache-2.0;
run `npm run notices` so their licence text ships with the app.
