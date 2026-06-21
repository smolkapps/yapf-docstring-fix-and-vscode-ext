# yapf-fix — fix for YAPF issue #575

Fixes [google/yapf#575](https://github.com/google/yapf/issues/575): when YAPF
re-indents a block, a multiline docstring's continuation lines and closing
triple quote stay at their original indentation while only the opening line
moves, producing inconsistent (and sometimes invalid) docstring indentation.

## Quick verify

```bash
bash run_yapf_tests.sh
```

This clones `google/yapf`, applies `0001-fix-docstring-continuation-line-indentation.patch`,
installs the patched yapf, and runs both YAPF's own test suite (with the two
added regression tests) and the standalone behavioral tests in `tests/`.

Verified: **613** of YAPF's own tests pass (611 baseline + 2 new), and the
**10** standalone tests pass. The new tests fail on unpatched YAPF and pass
after the patch.

## What's here

- **`0001-fix-docstring-continuation-line-indentation.patch`** — the upstream
  patch (modifies `yapf/yapflib/reformatter.py`, adds tests to
  `yapftests/reformatter_basic_test.py`, adds a CHANGELOG entry). This is the
  artifact to attach to a pull request. Apply with `git apply`.
- **`apply_fix.py`** — programmatic, idempotent form of the `reformatter.py`
  edit, used by the runner. The `.patch` is authoritative for contribution.
- **`tests/test_docstring_reindent.py`** — behavioral tests using only the
  public `yapf.yapflib.yapf_api.FormatCode` API (bug repro + corner cases:
  indent increase/decrease, relative-extra-indent preservation, tab→space,
  single-line, idempotency, no-op on already-correct code, module docstrings).
- **`run_yapf_tests.sh`** — end-to-end clone/patch/install/test runner.

## The fix in one paragraph

`_FormatFinalLines` emits each token as `whitespace_prefix + value`. For a
multiline docstring, only the opening line is re-indented (via the prefix); the
rest lives inside `value`. The new helper
`_ReindentDocstringContinuationLines(value, old_column, new_indent)` shifts every
continuation line by `len(new_indent) - old_column`, re-emitting indentation with
the new indent's whitespace character (spaces, or tabs under `USE_TABS`).
Whitespace-only lines are left untouched; the change is scoped to `is_docstring`
tokens so ordinary multiline string values are never altered.

## Upstream submission (human step)

Not submitted here — opening the PR requires a personal GitHub fork and the
project's CLA. See the root `README.md` for the exact commands.

The patch modifies Apache-2.0 code and is contributed under Apache-2.0.
