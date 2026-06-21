import { describe, it, expect, vi } from 'vitest';
import {
  YapfConfig,
  FormatRequest,
  ProcessRunner,
  RunResult,
  splitExecutable,
  buildArgs,
  interpretResult,
  formatWithYapf,
} from '../src/yapf';

const baseConfig: YapfConfig = { executable: 'yapf', args: [], style: '' };

function mockRunner(result: RunResult): ProcessRunner {
  return vi.fn(async () => result);
}

describe('splitExecutable', () => {
  it('splits a simple command', () => {
    expect(splitExecutable('yapf')).toEqual({ command: 'yapf', leadingArgs: [] });
  });
  it('splits a module-runner form', () => {
    expect(splitExecutable('python -m yapf')).toEqual({
      command: 'python',
      leadingArgs: ['-m', 'yapf'],
    });
  });
  it('falls back to yapf for empty', () => {
    expect(splitExecutable('   ')).toEqual({ command: 'yapf', leadingArgs: [] });
  });
});

describe('buildArgs', () => {
  it('omits style and lines by default and does not add --diff', () => {
    const args = buildArgs(baseConfig, { text: 'x=1\n' });
    expect(args).not.toContain('--diff');
    expect(args).not.toContain('--style');
    expect(args).not.toContain('--lines');
  });

  it('includes leading args from a module-runner executable', () => {
    const cfg: YapfConfig = { executable: 'python -m yapf', args: [], style: '' };
    const args = buildArgs(cfg, { text: 'x=1\n' });
    expect(args.slice(0, 2)).toEqual(['-m', 'yapf']);
  });

  it('adds --style when configured', () => {
    const cfg: YapfConfig = { ...baseConfig, style: 'pep8' };
    expect(buildArgs(cfg, { text: 'x=1\n' })).toContain('--style');
    expect(buildArgs(cfg, { text: 'x=1\n' })).toContain('pep8');
  });

  it('adds a 1-based inclusive --lines range', () => {
    const args = buildArgs(baseConfig, { text: 'a\nb\nc\n', lines: { start: 2, end: 3 } });
    const idx = args.indexOf('--lines');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('2-3');
  });

  it('appends extra user args last', () => {
    const cfg: YapfConfig = { ...baseConfig, args: ['--no-local-style'] };
    const args = buildArgs(cfg, { text: 'x=1\n' });
    expect(args[args.length - 1]).toBe('--no-local-style');
  });
});

describe('interpretResult', () => {
  it('reports an error on non-zero exit', () => {
    const out = interpretResult(
      { code: 1, stdout: '', stderr: 'yapf: <stdin>:1:7: invalid syntax' },
      'def f(:\n',
    );
    expect(out.kind).toBe('error');
    if (out.kind === 'error') {
      expect(out.message).toContain('invalid syntax');
    }
  });

  it('synthesizes a message when stderr is empty', () => {
    const out = interpretResult({ code: 3, stdout: '', stderr: '' }, 'x=1\n');
    expect(out).toEqual({ kind: 'error', message: 'yapf exited with code 3' });
  });

  it('reports unchanged when output equals input', () => {
    const text = 'def f(a):\n  x = 1\n  return x\n';
    expect(interpretResult({ code: 0, stdout: text, stderr: '' }, text)).toEqual({
      kind: 'unchanged',
    });
  });

  it('produces edits when output differs', () => {
    const original = 'def f():\n  x=1\n  return x\n';
    const formatted = 'def f():\n  x = 1\n  return x\n';
    const out = interpretResult({ code: 0, stdout: formatted, stderr: '' }, original);
    expect(out.kind).toBe('edits');
    if (out.kind === 'edits') {
      expect(out.formatted).toBe(formatted);
      expect(out.ops).toEqual([{ startLine: 1, endLine: 2, newLines: ['  x = 1'] }]);
    }
  });

  it('treats empty success output on non-empty input as an error', () => {
    const out = interpretResult({ code: 0, stdout: '', stderr: '' }, 'x=1\n');
    expect(out.kind).toBe('error');
  });
});

describe('formatWithYapf', () => {
  it('returns edits using the injected runner', async () => {
    const original = 'def f():\n  x=1\n';
    const formatted = 'def f():\n  x = 1\n';
    const run = mockRunner({ code: 0, stdout: formatted, stderr: '' });
    const out = await formatWithYapf(baseConfig, { text: original }, run);
    expect(out.kind).toBe('edits');
    expect(run).toHaveBeenCalledOnce();
  });

  it('passes the document text as stdin to the runner', async () => {
    const original = 'x=1\n';
    let captured = '';
    const run: ProcessRunner = async (_cmd, _args, input) => {
      captured = input;
      return { code: 0, stdout: 'x = 1\n', stderr: '' };
    };
    await formatWithYapf(baseConfig, { text: original }, run);
    expect(captured).toBe(original);
  });

  it('invokes the resolved command and args', async () => {
    const cfg: YapfConfig = { executable: 'python -m yapf', args: [], style: 'pep8' };
    const run = vi.fn<Parameters<ProcessRunner>, ReturnType<ProcessRunner>>(async () => ({
      code: 0,
      stdout: 'x = 1\n',
      stderr: '',
    }));
    await formatWithYapf(cfg, { text: 'x=1\n' }, run);
    const [command, args] = run.mock.calls[0];
    expect(command).toBe('python');
    expect(args).toContain('-m');
    expect(args).toContain('yapf');
    expect(args).toContain('--style');
  });

  it('maps a thrown runner (spawn failure) to an error outcome', async () => {
    const run: ProcessRunner = async () => {
      throw new Error('spawn yapf ENOENT');
    };
    const out = await formatWithYapf(baseConfig, { text: 'x=1\n' }, run);
    expect(out.kind).toBe('error');
    if (out.kind === 'error') {
      expect(out.message).toContain('ENOENT');
    }
  });

  it('reports unchanged when yapf returns identical text', async () => {
    const text = 'def f(a):\n  x = 1\n';
    const run = mockRunner({ code: 0, stdout: text, stderr: '' });
    const out = await formatWithYapf(baseConfig, { text }, run);
    expect(out.kind).toBe('unchanged');
  });
});
