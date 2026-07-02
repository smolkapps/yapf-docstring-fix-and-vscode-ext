/**
 * Host-layer tests for `editOpsToTextEdits`, the thin adapter that turns
 * line-range EditOps into VS Code TextEdits. `vscode` is mocked (there is no
 * extension host in vitest) with just enough surface — Position/Range/TextEdit
 * plus a document exposing `eol`, `lineCount`, and `lineAt` — to assert the
 * exact Range and newText each edit carries. These pin the three host-only
 * behaviours (document-EOL inserts, conditional final-newline strip, EOF
 * anchoring); reverting any of them turns one of these red.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
  class Position {
    constructor(
      public readonly line: number,
      public readonly character: number,
    ) {}
  }
  class Range {
    constructor(
      public readonly start: Position,
      public readonly end: Position,
    ) {}
  }
  return {
    Position,
    Range,
    EndOfLine: { LF: 1, CRLF: 2 },
    TextEdit: {
      replace: (range: unknown, newText: string) => ({ range, newText }),
    },
  };
});

import * as vscode from 'vscode';
import { editOpsToTextEdits } from '../src/extension';

/**
 * Minimal TextDocument stand-in. `lineLengths[i]` is the character length of
 * line `i`; `lineAt(i).range.end` reports `Position(i, lineLengths[i])`, which
 * is all `editOpsToTextEdits` reads off a line. `lineCount` follows VS Code:
 * a document ending in a newline has a phantom empty final line.
 */
function makeDoc(lineLengths: number[], eol: number): any {
  return {
    eol,
    lineCount: lineLengths.length,
    lineAt: (i: number) => ({ range: { end: new vscode.Position(i, lineLengths[i]) } }),
  };
}

const CRLF = vscode.EndOfLine.CRLF;
const LF = vscode.EndOfLine.LF;

describe('editOpsToTextEdits', () => {
  it('inserts using the document line ending (CRLF)', () => {
    // 'def f():\r\n    x = 1\r\n' -> two content lines + phantom empty last line.
    const doc = makeDoc([8, 9, 0], CRLF);
    const edits = editOpsToTextEdits(doc, [{ startLine: 1, endLine: 1, newLines: ['    y = 2'] }], true);
    expect(edits.length).toBe(1);
    const { range, newText } = edits[0] as any;
    expect(range.start).toEqual({ line: 1, character: 0 });
    expect(range.end).toEqual({ line: 1, character: 0 });
    // The inserted line carries CRLF, not a bare LF, so a CRLF file stays clean.
    expect(newText).toBe('    y = 2\r\n');
  });

  it('replaces through EOF and keeps the final newline yapf added', () => {
    // 'x=1' with no trailing newline -> single line, length 3.
    const doc = makeDoc([3], LF);
    const edits = editOpsToTextEdits(doc, [{ startLine: 0, endLine: 1, newLines: ['x = 1'] }], true);
    expect(edits.length).toBe(1);
    const { range, newText } = edits[0] as any;
    expect(range.start).toEqual({ line: 0, character: 0 });
    // Anchored at the true document end (0, 3), not a phantom next line.
    expect(range.end).toEqual({ line: 0, character: 3 });
    // keepFinalNewline is true, so the terminating newline survives.
    expect(newText).toBe('x = 1\n');
  });

  it('anchors a pure insert past a newline-less last line', () => {
    // 'x = 1' with no trailing newline; op.startLine (1) is past lineCount (1).
    const doc = makeDoc([5], LF);
    const edits = editOpsToTextEdits(doc, [{ startLine: 1, endLine: 2, newLines: ['y = 2'] }], true);
    expect(edits.length).toBe(1);
    const { range, newText } = edits[0] as any;
    // Zero-width edit at the true end of the last line.
    expect(range.start).toEqual({ line: 0, character: 5 });
    expect(range.end).toEqual({ line: 0, character: 5 });
    // Leads with a line break so the appended line starts fresh, and keeps its
    // own terminating newline because keepFinalNewline is true.
    expect(newText).toBe('\ny = 2\n');
  });

  it('drops the final newline of an EOF replace when the formatted output lacks one', () => {
    // keepFinalNewline is false: the strip branch must run so we don't add a
    // spurious blank line beyond what yapf produced.
    const doc = makeDoc([3], LF);
    const edits = editOpsToTextEdits(doc, [{ startLine: 0, endLine: 1, newLines: ['x = 1'] }], false);
    const { newText } = edits[0] as any;
    expect(newText).toBe('x = 1');
  });
});
