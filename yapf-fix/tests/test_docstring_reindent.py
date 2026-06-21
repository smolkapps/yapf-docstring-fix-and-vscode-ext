"""Behavioral regression tests for the YAPF issue #575 docstring fix.

These exercise the *public* ``yapf`` API (``FormatCode``) so they run against a
patched YAPF install without depending on any private internals. They encode
the bug from https://github.com/google/yapf/issues/575 and the corner cases the
fix must respect.

Run (after installing the patched yapf into the env)::

    pytest -q
"""

import textwrap

import pytest

yapf_api = pytest.importorskip("yapf.yapflib.yapf_api")
FormatCode = yapf_api.FormatCode


def fmt(code, style="pep8"):
    out, _changed = FormatCode(code, style_config=style)
    return out


def test_issue_575_exact_repro():
    """The exact input/output pair from issue #575."""
    src = textwrap.dedent('''\
      def GetArgs():
         """
         Some docstrings.
         """
         pass
  ''')
    expected = textwrap.dedent('''\
      def GetArgs():
          """
          Some docstrings.
          """
          pass
  ''')
    assert fmt(src) == expected


def test_indent_increase_body_and_close_follow():
    src = textwrap.dedent('''\
      def f():
        """Summary.

        Body at two spaces.
        """
        pass
  ''')
    expected = textwrap.dedent('''\
      def f():
          """Summary.

          Body at two spaces.
          """
          pass
  ''')
    assert fmt(src) == expected


def test_nested_method_alignment():
    src = textwrap.dedent('''\
      class C:
        def m(self):
          """Summary.

          Body.
          """
          return 1
  ''')
    expected = textwrap.dedent('''\
      class C:

          def m(self):
              """Summary.

              Body.
              """
              return 1
  ''')
    assert fmt(src) == expected


def test_indent_decrease():
    """Over-indented body collapses to match the opening quote."""
    src = textwrap.dedent('''\
      def f():
            """Summary.

            Body.
            """
            pass
  ''')
    expected = textwrap.dedent('''\
      def f():
          """Summary.

          Body.
          """
          pass
  ''')
    assert fmt(src) == expected


def test_relative_extra_indent_preserved():
    """Deeper-indented body lines (code examples) keep their relative offset."""
    src = textwrap.dedent('''\
      def f():
        """Summary.

        Example::

            x = 1
        """
        pass
  ''')
    expected = textwrap.dedent('''\
      def f():
          """Summary.

          Example::

              x = 1
          """
          pass
  ''')
    assert fmt(src) == expected


def test_tab_indented_block_converts_to_spaces():
    src = 'def f():\n\t"""Summary.\n\n\tBody.\n\t"""\n\tpass\n'
    expected = textwrap.dedent('''\
      def f():
          """Summary.

          Body.
          """
          pass
  ''')
    assert fmt(src) == expected


def test_single_line_docstring_unchanged_body():
    src = textwrap.dedent('''\
      def f():
         """One line."""
         pass
  ''')
    expected = textwrap.dedent('''\
      def f():
          """One line."""
          pass
  ''')
    assert fmt(src) == expected


def test_already_correct_is_noop():
    good = textwrap.dedent('''\
      def f():
          """Summary.

          Body.
          """
          pass
  ''')
    out, changed = FormatCode(good, style_config="pep8")
    assert out == good
    assert changed is False


def test_idempotent():
    src = textwrap.dedent('''\
      def GetArgs():
         """
         Some docstrings.
         """
         pass
  ''')
    once = fmt(src)
    assert fmt(once) == once


def test_module_docstring_unchanged():
    src = '"""Module doc.\n\nBody.\n"""\nimport os\n'
    assert fmt(src) == src
