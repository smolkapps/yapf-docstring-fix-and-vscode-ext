/**
 * VS Code glue. Registers YAPF as a document and range formatter for Python.
 * The interesting logic lives in `diff.ts` and `yapf.ts` (both unit-tested);
 * this file is the thin host adapter.
 */
import * as path from 'path';
import * as vscode from 'vscode';

import { EditOp } from './diff';
import { spawnRunner } from './runner';
import { FormatRequest, YapfConfig, formatWithYapf } from './yapf';

function readConfig(): YapfConfig {
  const cfg = vscode.workspace.getConfiguration('yapfFormatter');
  return {
    executable: cfg.get<string>('executable', 'yapf'),
    args: cfg.get<string[]>('args', []),
    style: cfg.get<string>('style', ''),
  };
}

export function editOpsToTextEdits(
  doc: vscode.TextDocument,
  ops: EditOp[],
  keepFinalNewline: boolean,
): vscode.TextEdit[] {
  // Emit line breaks matching the document so a CRLF file doesn't end up with
  // mixed line endings (TextEdits are applied verbatim).
  const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const edits: vscode.TextEdit[] = [];
  for (const op of ops) {
    // Replace the original [startLine, endLine) range. We address from the start
    // of `startLine` to the start of `endLine` so that whole lines (including
    // their trailing newline) are swapped cleanly. Ranges at or past the last
    // line (only reachable when the document lacks a final newline — otherwise
    // VS Code's phantom empty last line keeps indices in bounds) are anchored
    // to the true document end.
    let newText = op.newLines.map((l) => l + eol).join('');
    let start: vscode.Position;
    let end: vscode.Position;
    if (op.startLine >= doc.lineCount) {
      // Pure insertion past a last line that has no newline: anchor at the true
      // end and lead with a line break so the appended lines start fresh.
      start = doc.lineAt(doc.lineCount - 1).range.end;
      end = start;
      newText = eol + newText;
      if (!keepFinalNewline && newText.endsWith(eol)) {
        newText = newText.slice(0, -eol.length);
      }
    } else if (op.endLine >= doc.lineCount) {
      // Replacing through EOF: target the true end. Keep the final line break
      // exactly when the formatted output ends with one (yapf always
      // terminates with a newline), so the edit reproduces yapf's output
      // instead of silently preserving a missing final newline.
      start = new vscode.Position(op.startLine, 0);
      end = doc.lineAt(doc.lineCount - 1).range.end;
      if (!keepFinalNewline && newText.endsWith(eol)) {
        newText = newText.slice(0, -eol.length);
      }
    } else {
      start = new vscode.Position(op.startLine, 0);
      end = new vscode.Position(op.endLine, 0);
    }
    edits.push(vscode.TextEdit.replace(new vscode.Range(start, end), newText));
  }
  return edits;
}

async function provideEdits(
  document: vscode.TextDocument,
  range: vscode.Range | undefined,
  token: vscode.CancellationToken,
): Promise<vscode.TextEdit[]> {
  const config = readConfig();
  const cwd = workspaceDirFor(document);
  const req: FormatRequest = { text: document.getText(), cwd };
  if (range) {
    // VS Code ranges are 0-based; yapf --lines is 1-based inclusive.
    req.lines = { start: range.start.line + 1, end: range.end.line + 1 };
  }

  const outcome = await formatWithYapf(config, req, spawnRunner);
  if (token.isCancellationRequested) {
    return [];
  }
  switch (outcome.kind) {
    case 'unchanged':
      return [];
    case 'edits':
      return editOpsToTextEdits(document, outcome.ops, outcome.formatted.endsWith('\n'));
    case 'error':
      vscode.window.showErrorMessage(`YAPF: ${outcome.message}`);
      return [];
  }
}

function workspaceDirFor(document: vscode.TextDocument): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (folder) {
    return folder.uri.fsPath;
  }
  if (document.uri.scheme === 'file') {
    return path.dirname(document.uri.fsPath);
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: 'python' };

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits(document, _options, token) {
        return provideEdits(document, undefined, token);
      },
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, {
      provideDocumentRangeFormattingEdits(document, range, _options, token) {
        return provideEdits(document, range, token);
      },
    }),
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}
