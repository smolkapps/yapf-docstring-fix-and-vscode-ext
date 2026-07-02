# YAPF Formatter (VS Code)

Format Python with [YAPF](https://github.com/google/yapf) inside VS Code,
applying the **smallest possible edits** so code folds, decorations, and
unrelated cursor positions survive a format.

## Features

- Registers as a **document formatter** and **range formatter** for Python.
- Computes minimal line edits from YAPF's output (no whole-buffer replace).
- Works on unsaved buffers: YAPF is run on stdin (it rejects `--diff` on stdin),
  and the diff is computed client-side.
- Surfaces YAPF errors (e.g. syntax errors) without touching your file.
- Reproduces YAPF's output faithfully — including the final newline on files
  missing one — and inserted lines match the document's line endings (LF/CRLF).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `yapfFormatter.executable` | `yapf` | Path to yapf. Supports `python -m yapf`. |
| `yapfFormatter.style` | `""` | Value for YAPF's `--style`. Empty = let YAPF resolve `setup.cfg` / `.style.yapf` / `pyproject.toml`. |
| `yapfFormatter.args` | `[]` | Extra CLI args, e.g. `["--no-local-style"]`. |

Set it as the default Python formatter:

```jsonc
"[python]": {
  "editor.defaultFormatter": "smolkin.yapf-formatter",
  "editor.formatOnSave": true
}
```

## Requirements

YAPF must be installed and reachable via `yapfFormatter.executable`
(`pip install yapf`, or point at a virtualenv's `yapf`).

## Develop

```bash
npm install
npm run build      # tsc (strict)
npm test           # vitest — 49 tests (4 integration tests run when yapf is on PATH)
npx @vscode/vsce package --no-dependencies   # build a .vsix
```

### Architecture

The interesting logic is host-independent and unit-tested:

- `src/diff.ts` — `computeLineEdits(original, formatted)` (LCS line diff →
  minimal `EditOp[]`) and a unified-diff parser. No `vscode` import.
- `src/yapf.ts` — argument building and exit-code interpretation; the process
  spawn is injected so it is tested with a mock and against the real binary.
- `src/runner.ts` — the real spawn-based runner.
- `src/extension.ts` — thin VS Code adapter (maps `EditOp[]` → `TextEdit[]`).

## License

MIT. See `LICENSE`.
