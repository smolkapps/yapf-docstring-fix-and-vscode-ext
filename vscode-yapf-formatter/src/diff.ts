/**
 * Pure unified-diff parsing, independent of the VS Code API so it can be
 * unit-tested in plain Node.
 *
 * YAPF, when invoked with `--diff`, emits a standard unified diff describing how
 * to turn the original file into the formatted file. We translate each hunk into
 * a minimal line-range replacement so the editor applies the smallest possible
 * change (preserving folds, decorations, and unrelated cursors).
 */

/** A line-range replacement, with 0-based, end-exclusive line indices. */
export interface EditOp {
  /** First original line (0-based) affected by this edit. */
  startLine: number;
  /** One past the last original line (0-based, end-exclusive). */
  endLine: number;
  /**
   * Replacement text for the `[startLine, endLine)` range, expressed as whole
   * lines. The host turns this into a `TextEdit` over the corresponding range.
   */
  newLines: string[];
}

export interface Hunk {
  oldStart: number; // 1-based, as in the diff header
  oldCount: number;
  newStart: number; // 1-based
  newCount: number;
  /** Raw hunk body lines, each still prefixed with ' ', '+', '-' or '\\'. */
  lines: string[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified diff into hunks. Tolerant of the leading `--- ` / `+++ `
 * file headers (which YAPF emits) and of CRLF endings in the diff stream.
 */
export function parseUnifiedDiff(diffText: string): Hunk[] {
  if (!diffText) {
    return [];
  }
  const rawLines = diffText.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  for (const line of rawLines) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      current = {
        oldStart: parseInt(m[1], 10),
        oldCount: m[2] === undefined ? 1 : parseInt(m[2], 10),
        newStart: parseInt(m[3], 10),
        newCount: m[4] === undefined ? 1 : parseInt(m[4], 10),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) {
      // Skip file headers ("--- a", "+++ b") and any preamble.
      continue;
    }
    if (line.length === 0) {
      // A blank body line in a unified diff represents a context line that is an
      // empty line. Only treat it as such while inside a hunk that still expects
      // more lines; trailing blank lines after the final hunk are ignored.
      const consumed = countConsumed(current);
      if (consumed < current.oldCount + current.newCount) {
        current.lines.push(' ');
      }
      continue;
    }
    const tag = line[0];
    if (tag === ' ' || tag === '+' || tag === '-' || tag === '\\') {
      current.lines.push(line);
    } else {
      // Unknown line type -> the diff body for this hunk has ended.
      current = null;
    }
  }
  return hunks;
}

function countConsumed(h: Hunk): number {
  let old = 0;
  let neu = 0;
  for (const l of h.lines) {
    const t = l[0];
    if (t === ' ') {
      old++;
      neu++;
    } else if (t === '-') {
      old++;
    } else if (t === '+') {
      neu++;
    }
  }
  return old + neu;
}

/**
 * Convert a single hunk into one minimal `EditOp`.
 *
 * We trim leading and trailing *context* lines (those common to both sides) so
 * the produced edit covers only the changed region. The result's range is in
 * terms of original-document line numbers.
 */
export function hunkToEditOp(hunk: Hunk): EditOp | null {
  // Separate the body into per-side sequences while remembering, for the old
  // side, which original line each entry maps to.
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const l of hunk.lines) {
    const tag = l[0];
    const text = l.slice(1);
    if (tag === ' ') {
      oldLines.push(text);
      newLines.push(text);
    } else if (tag === '-') {
      oldLines.push(text);
    } else if (tag === '+') {
      newLines.push(text);
    }
    // '\\' (No newline at end of file) carries no content for our purposes.
  }

  // Find common prefix (context) length.
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix] &&
    // Only strip lines that are genuinely context on both sides.
    isContextAt(hunk, prefix, prefix)
  ) {
    prefix++;
  }

  // Find common suffix (context) length, not overlapping the prefix.
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);

  if (oldChanged.length === 0 && newChanged.length === 0) {
    return null; // Pure-context hunk, nothing to do.
  }

  // The original line where the changed region starts (0-based).
  const startLine = hunk.oldStart - 1 + prefix;
  const endLine = startLine + oldChanged.length;

  return { startLine, endLine, newLines: newChanged };
}

/**
 * Whether the body, taken in order, has a context line at both the given old and
 * new positions. We approximate by checking the hunk body: a stripped pair is
 * "context" only if every body entry up to here is a context (' ') line. This
 * keeps prefix trimming conservative and correct for YAPF's diffs, which always
 * lead changed hunks with context.
 */
function isContextAt(hunk: Hunk, oldIdx: number, newIdx: number): boolean {
  let o = 0;
  let n = 0;
  for (const l of hunk.lines) {
    const tag = l[0];
    if (tag === ' ') {
      if (o === oldIdx && n === newIdx) {
        return true;
      }
      o++;
      n++;
    } else if (tag === '-') {
      if (o === oldIdx) {
        return false;
      }
      o++;
    } else if (tag === '+') {
      if (n === newIdx) {
        return false;
      }
      n++;
    }
  }
  return false;
}

/** Translate a whole unified diff into a list of minimal edit operations. */
export function diffToEditOps(diffText: string): EditOp[] {
  const ops: EditOp[] = [];
  for (const hunk of parseUnifiedDiff(diffText)) {
    const op = hunkToEditOp(hunk);
    if (op) {
      ops.push(op);
    }
  }
  return ops;
}

/** Split a document into lines, preserving the (possibly absent) final newline. */
export function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text.length === 0) {
    return { lines: [], trailingNewline: false };
  }
  const normalized = text.replace(/\r\n/g, '\n');
  const trailingNewline = normalized.endsWith('\n');
  const body = trailingNewline ? normalized.slice(0, -1) : normalized;
  return { lines: body.split('\n'), trailingNewline };
}

/**
 * Compute minimal whole-line edits transforming `original` into `formatted`.
 *
 * This is the primary path: YAPF run on stdin returns the *entire* formatted
 * document, and we diff it against the original here so the editor applies the
 * smallest change set (rather than replacing the whole buffer, which would reset
 * folds and decorations). Uses a standard LCS over lines, then coalesces runs
 * of deletions/insertions into contiguous replacement ranges.
 *
 * Indices in the returned ops are 0-based, end-exclusive, over `original`'s
 * lines.
 */
export function computeLineEdits(original: string, formatted: string): EditOp[] {
  if (original === formatted) {
    return [];
  }
  const a = splitLines(original).lines;
  const b = splitLines(formatted).lines;

  // LCS length table. Documents handled by an editor are small enough for the
  // O(n*m) table; YAPF is line-oriented so this is more than adequate.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // Walk the table, emitting an edit script of equal / delete / insert.
  type Step = { type: 'eq' | 'del' | 'ins'; aIdx: number; text?: string };
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      steps.push({ type: 'eq', aIdx: i });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      steps.push({ type: 'del', aIdx: i });
      i++;
    } else {
      steps.push({ type: 'ins', aIdx: i, text: b[j] });
      j++;
    }
  }
  while (i < n) {
    steps.push({ type: 'del', aIdx: i });
    i++;
  }
  while (j < m) {
    steps.push({ type: 'ins', aIdx: n, text: b[j] });
    j++;
  }

  // Coalesce consecutive del/ins steps into replacement ranges.
  const ops: EditOp[] = [];
  let k = 0;
  while (k < steps.length) {
    if (steps[k].type === 'eq') {
      k++;
      continue;
    }
    const startLine = steps[k].aIdx;
    let endLine = startLine;
    const newLines: string[] = [];
    while (k < steps.length && steps[k].type !== 'eq') {
      const step = steps[k];
      if (step.type === 'del') {
        endLine = step.aIdx + 1;
      } else {
        newLines.push(step.text as string);
      }
      k++;
    }
    ops.push({ startLine, endLine, newLines });
  }
  return ops;
}
