/**
 * Integration tests that drive the REAL yapf binary through the real spawn
 * runner. Skipped automatically when no yapf is on PATH so unit CI stays
 * hermetic; run them where yapf is installed for end-to-end coverage.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { spawnRunner } from '../src/runner';
import { YapfConfig, formatWithYapf } from '../src/yapf';
import { splitLines } from '../src/diff';

function yapfAvailable(): boolean {
  try {
    execFileSync('yapf', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasYapf = yapfAvailable();
const describeIf = hasYapf ? describe : describe.skip;

const config: YapfConfig = { executable: 'yapf', args: [], style: 'pep8' };

/** Apply ops to original (bottom-up) to reconstruct the formatted text. */
function apply(original: string, ops: { startLine: number; endLine: number; newLines: string[] }[]) {
  const { lines, trailingNewline } = splitLines(original);
  const out = [...lines];
  for (const op of [...ops].sort((a, b) => b.startLine - a.startLine)) {
    out.splice(op.startLine, op.endLine - op.startLine, ...op.newLines);
  }
  let text = out.join('\n');
  if (trailingNewline && text.length > 0) {
    text += '\n';
  }
  return text;
}

describeIf('integration (real yapf)', () => {
  it('formats messy code and the edits reconstruct yapf output', async () => {
    const original = 'def f( a ,b ):\n    x=1\n    return    x\n';
    const out = await formatWithYapf(config, { text: original }, spawnRunner);
    expect(out.kind).toBe('edits');
    if (out.kind === 'edits') {
      expect(apply(original, out.ops)).toBe(out.formatted);
      // Sanity: the formatted text has normalized spacing.
      expect(out.formatted).toContain('def f(a, b):');
    }
  });

  it('reports unchanged for already-formatted code', async () => {
    const text = 'def f(a, b):\n    x = 1\n    return x\n';
    const out = await formatWithYapf(config, { text }, spawnRunner);
    expect(out.kind).toBe('unchanged');
  });

  it('reports an error for invalid syntax', async () => {
    const out = await formatWithYapf(config, { text: 'def f(:\n' }, spawnRunner);
    expect(out.kind).toBe('error');
  });
});
