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

function editOpsToTextEdits(doc: vscode.TextDocument, ops: EditOp[]): vscode.TextEdit[] {
  const edits: vscode.TextEdit[] = [];
  for (const op of ops) {
    // Replace the original [startLine, endLine) range. We address from the start
    // of `startLine` to the start of `endLine` so that whole lines (including
    // their trailing newline) are swapped cleanly. When endLine is past the last
    // line, clamp to the document end.
    const start = new vscode.Position(op.startLine, 0);
    let end: vscode.Position;
    let newText = op.newLines.map((l) => l + '\n').join('');
    if (op.endLine >= doc.lineCount) {
      // Replacing through EOF: target the true end and drop the final newline so
      // we don't introduce a spurious blank line.
      end = doc.lineAt(doc.lineCount - 1).range.end;
      if (newText.endsWith('\n')) {
        newText = newText.slice(0, -1);
      }
    } else {
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
      return editOpsToTextEdits(document, outcome.ops);
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
