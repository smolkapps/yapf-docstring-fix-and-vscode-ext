#!/usr/bin/env bash
# Clone a fresh YAPF, apply the issue-#575 fix patch, install it, and run both
# YAPF's own suite (with the added regression tests) and the standalone
# behavioral tests in tests/.
#
# Designed to run on a Linux build host (e.g. alienware-r8). Idempotent.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${1:-/tmp/yapf-575-work}"
PATCH="$HERE/0001-fix-docstring-continuation-line-indentation.patch"

rm -rf "$WORK"
git clone --depth 1 https://github.com/google/yapf.git "$WORK"
cd "$WORK"

echo "== applying patch =="
git apply --whitespace=nowarn "$PATCH"
git --no-pager diff --stat

echo "== creating venv + installing patched yapf =="
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -e .
.venv/bin/pip install -q pytest

echo "== running YAPF's own test suite (includes new regression tests) =="
.venv/bin/python -m pytest yapftests/ -q

echo "== running standalone behavioral tests =="
.venv/bin/python -m pytest "$HERE/tests" -q

echo "ALL GREEN"
