import {
  WorkspaceEdit,
  LineChange,
  TextEditor,
  Range,
  workspace,
  window,
  Position
} from "vscode";
import { applyLineChanges } from "../lineChanges";
import { toSvnUri, SvnUriAction } from "./uri";
import * as path from "path";

export async function revertChanges(
  textEditor: TextEditor,
  changes: LineChange[]
): Promise<void> {
  const modifiedDocument = textEditor.document;
  const modifiedUri = modifiedDocument.uri;

  if (modifiedUri.scheme !== "file") {
    return;
  }

  const originalUri = toSvnUri(modifiedUri, SvnUriAction.SHOW, {
    ref: "BASE"
  });
  const originalDocument = await workspace.openTextDocument(originalUri);
  const basename = path.basename(modifiedUri.fsPath);
  const message = `Are you sure you want to revert the selected changes in ${basename}?`;
  const yes = "Revert Changes";
  const pick = await window.showWarningMessage(message, { modal: true }, yes);

  if (pick !== yes) {
    return;
  }

  const result = applyLineChanges(originalDocument, modifiedDocument, changes);
  const edit = new WorkspaceEdit();
  edit.replace(
    modifiedUri,
    new Range(
      new Position(0, 0),
      modifiedDocument.lineAt(modifiedDocument.lineCount - 1).range.end
    ),
    result
  );
  workspace.applyEdit(edit);
  await modifiedDocument.save();
}
