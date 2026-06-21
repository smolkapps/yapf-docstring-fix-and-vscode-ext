#!/usr/bin/env python3
"""Apply the issue-#575 docstring-reindent fix to a YAPF reformatter.py in place.

This is the programmatic form of
``0001-fix-docstring-continuation-line-indentation.patch`` for the
``reformatter.py`` portion. It is idempotent and is used by ``run_yapf_tests.sh``
to patch a fresh YAPF checkout in CI-like runs. For an actual upstream
contribution, apply the ``.patch`` file with ``git apply`` instead.

Usage::

    python3 apply_fix.py /path/to/yapf/yapflib/reformatter.py
"""

import io
import sys

PATH = sys.argv[1]

with io.open(PATH, encoding="utf-8") as f:
    src = f.read()

if "_ReindentDocstringContinuationLines" in src:
    print("ALREADY PATCHED")
    sys.exit(0)

HELPER = r'''def _ReindentDocstringContinuationLines(value, old_column, new_indent):
  """Shift a multiline docstring's continuation lines to a new indentation.

  YAPF re-indents the *opening* line of a docstring (the line holding the
  opening triple quote) via the token's whitespace prefix, but the continuation
  lines and the closing triple quote live inside the token's literal ``value``
  and are emitted verbatim.  When the opening line moves, the rest of the
  docstring is left at its original indentation, producing inconsistent output
  (https://github.com/google/yapf/issues/575).

  This shifts every continuation line by the same amount as the opening line so
  the docstring keeps its internal relative layout while becoming consistent
  with the new block indentation.  Whitespace-only lines are left untouched so
  that no trailing whitespace is introduced.

  Arguments:
    value: (str) The full text of the docstring token, including quotes.
    old_column: (int) The original source column of the opening quote.
    new_indent: (str) The new leading-whitespace string for the opening line.

  Returns:
    The docstring text with its continuation lines re-indented.
  """
  if '\n' not in value:
    return value

  delta = len(new_indent) - old_column
  if delta == 0:
    return value

  # Re-emit added indentation using the same whitespace character as the new
  # opening indent (tabs under USE_TABS, spaces otherwise).
  indent_char = '\t' if new_indent.startswith('\t') else ' '

  lines = value.split('\n')
  result = [lines[0]]  # The opening line is already placed by the prefix.
  for line in lines[1:]:
    stripped = line.lstrip(' \t')
    if not stripped:
      # Blank / whitespace-only line: keep as-is, never add trailing space.
      result.append(line)
      continue
    old_leading = len(line) - len(stripped)
    new_leading = max(0, old_leading + delta)
    result.append(indent_char * new_leading + stripped)

  return '\n'.join(result)


'''

ANCHOR = "def _FormatFinalLines(final_lines):"
assert ANCHOR in src, "anchor not found"
src = src.replace(ANCHOR, HELPER + ANCHOR, 1)

OLD_EMIT = """    for tok in line.tokens:
      if not tok.is_pseudo:
        formatted_line.append(tok.formatted_whitespace_prefix)
        formatted_line.append(tok.value)"""

NEW_EMIT = """    for tok in line.tokens:
      if not tok.is_pseudo:
        whitespace_prefix = tok.formatted_whitespace_prefix
        formatted_line.append(whitespace_prefix)
        if tok.is_docstring and '\\n' in tok.value:
          new_indent = whitespace_prefix.rsplit('\\n', 1)[-1]
          formatted_line.append(
              _ReindentDocstringContinuationLines(tok.value, tok.column,
                                                  new_indent))
        else:
          formatted_line.append(tok.value)"""

assert OLD_EMIT in src, "emit block not found"
src = src.replace(OLD_EMIT, NEW_EMIT, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)
print("PATCHED OK")
