/** Real {@link ProcessRunner} backed by Node's child_process. */
import { spawn } from 'child_process';
import { ProcessRunner, RunResult } from './yapf';

export const spawnRunner: ProcessRunner = (command, args, input, cwd): Promise<RunResult> => {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.on('error', () => {
      /* ignore EPIPE if yapf closes stdin early */
    });
    child.stdin.write(input);
    child.stdin.end();
  });
};
