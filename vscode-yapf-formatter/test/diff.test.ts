import { describe, it, expect } from 'vitest';
import {
  EditOp,
  computeLineEdits,
  splitLines,
  parseUnifiedDiff,
  hunkToEditOp,
  diffToEditOps,
} from '../src/diff';

/**
 * Apply EditOps (0-based, end-exclusive whole-line ranges) to `original` to
 * reconstruct the formatted text. Mirrors what the VS Code host does, so a
 * successful round-trip proves the ops are correct end-to-end.
 */
function applyEditOps(original: string, ops: EditOp[]): string {
  const { lines, trailingNewline } = splitLines(original);
  // Apply from the bottom up so earlier indices stay valid.
  const sorted = [...ops].sort((a, b) => b.startLine - a.startLine);
  const out = [...lines];
  for (const op of sorted) {
    out.splice(op.startLine, op.endLine - op.startLine, ...op.newLines);
  }
  let text = out.join('\n');
  if (trailingNewline && text.length > 0) {
    text += '\n';
  }
  return text;
}

describe('splitLines', () => {
  it('handles trailing newline', () => {
    expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b'], trailingNewline: true });
  });
  it('handles no trailing newline', () => {
    expect(splitLines('a\nb')).toEqual({ lines: ['a', 'b'], trailingNewline: false });
  });
  it('handles empty', () => {
    expect(splitLines('')).toEqual({ lines: [], trailingNewline: false });
  });
  it('normalizes CRLF', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual({ lines: ['a', 'b'], trailingNewline: true });
  });
});

describe('computeLineEdits', () => {
  it('returns no edits for identical text', () => {
    expect(computeLineEdits('a\nb\n', 'a\nb\n')).toEqual([]);
  });

  it('produces a single-line replacement', () => {
    const original = 'def f():\n  x=1\n  return x\n';
    const formatted = 'def f():\n  x = 1\n  return x\n';
    const ops = computeLineEdits(original, formatted);
    expect(ops).toEqual([{ startLine: 1, endLine: 2, newLines: ['  x = 1'] }]);
    expect(applyEditOps(original, ops)).toBe(formatted);
  });

  it('round-trips a multi-hunk change', () => {
    const original = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n') + '\n';
    const formatted = ['a', 'B', 'c', 'd', 'E', 'f'].join('\n') + '\n';
    const ops = computeLineEdits(original, formatted);
    // Two separate single-line replacements (lines 1 and 4).
    expect(ops.length).toBe(2);
    expect(applyEditOps(original, ops)).toBe(formatted);
  });

  it('handles pure insertion', () => {
    const original = 'a\nc\n';
    const formatted = 'a\nb\nc\n';
    const ops = computeLineEdits(original, formatted);
    expect(applyEditOps(original, ops)).toBe(formatted);
    // Insertion is a zero-width range (startLine == endLine).
    expect(ops[0].startLine).toBe(ops[0].endLine);
    expect(ops[0].newLines).toEqual(['b']);
  });

  it('handles pure deletion', () => {
    const original = 'a\nb\nc\n';
    const formatted = 'a\nc\n';
    const ops = computeLineEdits(original, formatted);
    expect(applyEditOps(original, ops)).toBe(formatted);
    expect(ops[0].newLines).toEqual([]);
  });

  it('handles appending lines at EOF', () => {
    const original = 'a\nb\n';
    const formatted = 'a\nb\nc\nd\n';
    const ops = computeLineEdits(original, formatted);
    expect(applyEditOps(original, ops)).toBe(formatted);
  });

  it('handles removing trailing lines', () => {
    const original = 'a\nb\nc\nd\n';
    const formatted = 'a\nb\n';
    const ops = computeLineEdits(original, formatted);
    expect(applyEditOps(original, ops)).toBe(formatted);
  });

  it('round-trips the docstring-reindent change (issue #575 fix output)', () => {
    const original = 'def GetArgs():\n   """\n   Some docstrings.\n   """\n   pass\n';
    const formatted = 'def GetArgs():\n    """\n    Some docstrings.\n    """\n    pass\n';
    const ops = computeLineEdits(original, formatted);
    expect(applyEditOps(original, ops)).toBe(formatted);
  });

  it('normalizes CRLF input before diffing', () => {
    const original = 'a\r\nx=1\r\n';
    const formatted = 'a\nx = 1\n';
    const ops = computeLineEdits(original, formatted);
    expect(applyEditOps(original, ops)).toBe(formatted);
  });
});

describe('parseUnifiedDiff / hunkToEditOp', () => {
  // A real-shaped yapf-style unified diff.
  const diff = [
    '--- a',
    '+++ b',
    '@@ -1,3 +1,3 @@',
    ' def f():',
    '-  x=1',
    '+  x = 1',
    '   return x',
    '',
  ].join('\n');

  it('parses one hunk with correct counts', () => {
    const hunks = parseUnifiedDiff(diff);
    expect(hunks.length).toBe(1);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].oldCount).toBe(3);
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].newCount).toBe(3);
  });

  it('converts the hunk into a minimal edit', () => {
    const hunks = parseUnifiedDiff(diff);
    const op = hunkToEditOp(hunks[0]);
    // Only line index 1 (the "x=1" line) changed.
    expect(op).toEqual({ startLine: 1, endLine: 2, newLines: ['  x = 1'] });
  });

  it('handles an insertion-only hunk', () => {
    const insDiff = ['@@ -1,1 +1,2 @@', ' a', '+b'].join('\n');
    const ops = diffToEditOps(insDiff);
    expect(ops).toEqual([{ startLine: 1, endLine: 1, newLines: ['b'] }]);
  });

  it('handles a deletion-only hunk', () => {
    const delDiff = ['@@ -1,2 +1,1 @@', ' a', '-b'].join('\n');
    const ops = diffToEditOps(delDiff);
    expect(ops).toEqual([{ startLine: 1, endLine: 2, newLines: [] }]);
  });

  it('returns nothing for an empty diff', () => {
    expect(diffToEditOps('')).toEqual([]);
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
