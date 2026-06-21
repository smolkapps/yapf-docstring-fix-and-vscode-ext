/**
 * Building and interpreting YAPF invocations. The actual process spawn is
 * injected so the orchestration logic can be unit-tested without a real yapf.
 *
 * YAPF refuses `--diff`/`--in-place` when reading from stdin, so for editor
 * formatting we run it in plain stdin mode (it prints the *entire* formatted
 * document on stdout with exit 0) and compute minimal line edits client-side.
 */
import { EditOp, computeLineEdits } from './diff';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Spawns a process, feeds `input` on stdin, resolves with its result. */
export type ProcessRunner = (
  command: string,
  args: string[],
  input: string,
  cwd?: string,
) => Promise<RunResult>;

export interface YapfConfig {
  /** Executable; may contain spaces, e.g. "python -m yapf". */
  executable: string;
  /** Extra user args. */
  args: string[];
  /** Value for --style, or empty to omit. */
  style: string;
}

export interface FormatRequest {
  text: string;
  /** Optional 1-based inclusive line range to format (range formatting). */
  lines?: { start: number; end: number };
  /** Working directory so yapf can locate the nearest style config. */
  cwd?: string;
}

export type FormatOutcome =
  | { kind: 'unchanged' }
  | { kind: 'edits'; ops: EditOp[]; formatted: string }
  | { kind: 'error'; message: string };

/**
 * Split a configured executable string into command + leading args. Supports
 * the common `python -m yapf` form. Does not attempt full shell parsing.
 */
export function splitExecutable(executable: string): { command: string; leadingArgs: string[] } {
  const parts = executable.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { command: 'yapf', leadingArgs: [] };
  }
  return { command: parts[0], leadingArgs: parts.slice(1) };
}

/** Build the full argv (excluding the command itself) for a stdin run. */
export function buildArgs(config: YapfConfig, req: FormatRequest): string[] {
  const { leadingArgs } = splitExecutable(config.executable);
  const args: string[] = [...leadingArgs];
  if (config.style) {
    args.push('--style', config.style);
  }
  if (req.lines) {
    args.push('--lines', `${req.lines.start}-${req.lines.end}`);
  }
  args.push(...config.args);
  // No file argument => yapf reads from stdin and writes the full result to
  // stdout. We deliberately avoid --diff/--in-place (rejected on stdin).
  return args;
}

/**
 * Interpret a yapf stdin-mode result against the original text.
 *
 * Exit 0 = success; stdout is the full formatted document. Any non-zero exit is
 * an error (e.g. a syntax error), with details on stderr.
 */
export function interpretResult(result: RunResult, original: string): FormatOutcome {
  if (result.code !== 0) {
    const message = result.stderr.trim() || `yapf exited with code ${result.code}`;
    return { kind: 'error', message };
  }
  const formatted = result.stdout;
  // Guard against a runner that produced no output on success.
  if (formatted.length === 0 && original.length !== 0) {
    return { kind: 'error', message: 'yapf produced empty output' };
  }
  const ops = computeLineEdits(original, formatted);
  if (ops.length === 0) {
    return { kind: 'unchanged' };
  }
  return { kind: 'edits', ops, formatted };
}

/** Orchestrate a format request end-to-end using an injected runner. */
export async function formatWithYapf(
  config: YapfConfig,
  req: FormatRequest,
  run: ProcessRunner,
): Promise<FormatOutcome> {
  const { command } = splitExecutable(config.executable);
  const args = buildArgs(config, req);
  let result: RunResult;
  try {
    result = await run(command, args, req.text, req.cwd);
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  return interpretResult(result, req.text);
}
