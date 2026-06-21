# yapf-docstring-fix-and-vscode-ext

Two related YAPF tooling deliverables:

1. **`yapf-fix/`** — a fix for a real, open YAPF bug
   ([google/yapf#575](https://github.com/google/yapf/issues/575)): when a block
   is re-indented, the continuation lines and closing triple quote of a
   multiline docstring are left at their original indentation while only the
   opening line moves. Ships as a clean `git apply`-able patch with two new
   regression tests, ready for an upstream pull request.

2. **`vscode-yapf-formatter/`** — a Manifest-complete VS Code extension that runs
   YAPF as a Python document/range formatter, applying **minimal** edits (not a
   whole-buffer replace) so folds, decorations, and unrelated cursors survive.

Both are verified green on a Linux build host (Ubuntu 24.04, Node 24, Python
3.12) against real YAPF 0.43.0.

---

## 1. The YAPF docstring fix (`yapf-fix/`)

### The bug (issue #575)

Input (3-space indent, consistent docstring):

```python
def GetArgs():
   """
   Some docstrings.
   """
   pass
```

YAPF (≤ 0.43.0) output — opening quote moved to 4 spaces, **body and closing
quote stranded at 3**:

```python
def GetArgs():
    """
   Some docstrings.
   """
    pass
```

The docstring is now mis-indented: the closing `"""` no longer aligns with the
opening `"""`, and the body's leading whitespace (which `inspect.getdoc()` and
Sphinx read) is wrong. The bug is worse when a *correctly* aligned docstring is
re-indented (e.g. a 4-space method body normalized to a different width) — YAPF
turns valid formatting into invalid formatting.

### The fix

`yapf/yapflib/reformatter.py` emits each token as `whitespace_prefix + value`.
For a multiline docstring, `whitespace_prefix` re-indents only the opening line;
the continuation lines live inside `value` and are emitted verbatim. The fix
adds `_ReindentDocstringContinuationLines(...)`, called from `_FormatFinalLines`
for docstring tokens, which shifts every continuation line (and the closing
quote) by the same delta as the opening line. It:

- preserves the docstring's internal relative layout (indented code examples
  keep their extra indentation);
- leaves whitespace-only lines untouched (no introduced trailing whitespace);
- is scoped to `is_docstring` tokens only, so intentionally flush-left data in
  ordinary multiline string *values* is never disturbed;
- works for indent increases, decreases, and tab→space normalization.

Diff size: **+58 / −2** in `reformatter.py`, plus 2 regression tests and a
CHANGELOG entry.

### Files

- `0001-fix-docstring-continuation-line-indentation.patch` — the complete
  upstream patch (reformatter + tests + CHANGELOG). Apply with `git apply`.
- `apply_fix.py` — programmatic form of the `reformatter.py` change (idempotent),
  used by the runner; the `.patch` is the authoritative artifact for a PR.
- `tests/test_docstring_reindent.py` — 10 standalone behavioral tests against the
  public `yapf` API (bug repro + corner cases).
- `run_yapf_tests.sh` — clones a fresh YAPF, applies the patch, installs it, runs
  YAPF's own suite **and** the standalone tests.

### Reproduce / verify

```bash
cd yapf-fix
bash run_yapf_tests.sh          # clones google/yapf, applies patch, runs everything
```

Verified result (against `google/yapf@main`, 0.43.0):

```
== applying patch ==  3 files changed, 115 insertions(+), 2 deletions(-)
== YAPF's own suite ==  613 passed       (611 baseline + 2 new regression tests)
== standalone tests ==  10 passed
ALL GREEN
```

The two new regression tests fail on unpatched YAPF and pass after the patch —
a proper red/green proof.

### Upstream PR (human step)

The patch is contribution-ready but **not** submitted — opening a PR needs a
GitHub fork under your account and agreeing to the project's CLA. To submit:

```bash
git clone https://github.com/google/yapf.git && cd yapf
git checkout -b fix/575-docstring-continuation-indent
git apply /path/to/yapf-fix/0001-fix-docstring-continuation-line-indentation.patch
git commit -am "Re-indent docstring continuation lines with the opening line (#575)"
# push to your fork and open the PR against google/yapf
```

> Licensing: this patch modifies YAPF, which is **Apache-2.0**; contributed
> upstream it is Apache-2.0. The rest of this repository (the extension, test
> harness, scripts) is MIT — see `LICENSE`.

---

## 2. VS Code extension (`vscode-yapf-formatter/`)

A Manifest V3-style VS Code extension registering YAPF as a
`DocumentFormattingEditProvider` and `DocumentRangeFormattingEditProvider` for
Python.

### Design

- **stdin mode, not `--diff`.** YAPF *rejects* `--diff`/`--in-place` when reading
  from stdin (verified), which is exactly how an editor feeds an unsaved buffer.
  So the extension runs `yapf` on stdin (full formatted document on stdout, exit
  0) and computes minimal **line edits client-side** via an LCS line diff
  (`computeLineEdits`). This avoids whole-buffer replacement.
- **Injected process runner.** All orchestration (`buildArgs`,
  `interpretResult`, `formatWithYapf`) takes the spawn as a parameter, so the
  logic is unit-tested with a mock and against the real binary.
- **Exit-code semantics** (verified against yapf 0.43.0): exit 0 = success
  (stdout is the full result); non-zero (e.g. 1 on a syntax error) = error shown
  to the user, buffer left untouched.

### Source

| File | Role |
| --- | --- |
| `src/diff.ts` | Pure line diff (`computeLineEdits`) + a unified-diff parser; no `vscode` import → unit-testable. |
| `src/yapf.ts` | Build args, interpret results, orchestrate; spawn injected. |
| `src/runner.ts` | Real `ProcessRunner` over `child_process.spawn`. |
| `src/extension.ts` | Thin VS Code host adapter; maps `EditOp[]` → `vscode.TextEdit[]`, registers providers. |

### Settings

- `yapfFormatter.executable` (default `yapf`; supports `python -m yapf`)
- `yapfFormatter.style` (value for `--style`; empty lets YAPF resolve its own)
- `yapfFormatter.args` (extra CLI args)

### Build / test / package

```bash
cd vscode-yapf-formatter
npm install
npm run build      # tsc, strict mode
npm test           # vitest: 39 tests (incl. real-yapf integration when yapf is on PATH)
npx @vscode/vsce package --no-dependencies   # -> yapf-formatter-0.1.0.vsix (loadable)
```

Verified result: **39 tests passing** (18 diff + 18 orchestration + 3 real-yapf
integration). `npm run build` clean. Packages to a loadable `.vsix`.

Load locally: VS Code → Extensions → "Install from VSIX…" → pick the `.vsix`,
then set `editor.defaultFormatter` to this extension for Python.

---

## Repository layout

```
yapf-docstring-fix-and-vscode-ext/
├── README.md
├── LICENSE                       # MIT (repo glue; the YAPF patch is Apache-2.0)
├── .gitignore
├── yapf-fix/
│   ├── 0001-fix-docstring-continuation-line-indentation.patch
│   ├── apply_fix.py
│   ├── run_yapf_tests.sh
│   ├── README.md
│   └── tests/test_docstring_reindent.py
└── vscode-yapf-formatter/
    ├── package.json  tsconfig.json  vitest.config.ts
    ├── src/{diff,yapf,runner,extension}.ts
    └── test/{diff,yapf,integration}.test.ts
```
