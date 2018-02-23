import { QuickPickItem, window } from "vscode";
import { Repository } from "../repository";
import * as Mime from 'mime';
import * as path from "path";

interface IPropertyPick extends QuickPickItem {
  run: any;
}

class PropertyExecutablePick implements IPropertyPick {
  get label(): string {
    return "executable";
  }

  get description(): string {
    return "";
  }

  async run(repository: Repository, fsPath: string) {
    return repository.propset(this.label, ["ON", fsPath]);
  }
}


class PropertyIgnorePick implements IPropertyPick {
  get label(): string {
    return "ignore";
  }

  get description(): string {
    return "";
  }

  async run(repository: Repository, fsPath: string) {
    const directory = path.dirname(fsPath);
    const filename = path.basename(fsPath);
    return repository.ignore(directory, filename);
  }
}


class PropertyMimeTypePick implements IPropertyPick {
  get label(): string {
    return "mime-type";
  }

  get description(): string {
    return "Set the mime-type for file";
  }

  async run(repository: Repository, fsPath: string) {
    const mimeType = await window.showInputBox({
      value: "",
      placeHolder: "Enter the mime-type",
      prompt: "Please enter the mime-type",
      ignoreFocusOut: true
    });

    if (!mimeType) {
      return;
    }
    
    if (!Mime.getType(mimeType)) {
        window.showErrorMessage('mime-type is not valid');
        return;
    }

    return repository.propset(this.label, [mimeType, fsPath]);
  }
}


class PropertyEOLStylePick implements IPropertyPick {
  get label(): string {
    return "eol-style";
  }

  get description(): string {
    return "Select the line-ending for this file";
  }

  async run(repository: Repository, fsPath: string) {
    const choice = await window.showQuickPick(
      [{ label: "CRLF", description: "" }, { label: "LF", description: "" }],
      {
        placeHolder: "Select EOL marker"
      }
    );

    if (!choice) {
      return;
    }

    return repository.propset(this.label, [choice.label, fsPath]);
  }
}


export function getPropertyPicks() {
  return [
    new PropertyExecutablePick(),
    new PropertyIgnorePick(),
    new PropertyMimeTypePick(),
    new PropertyEOLStylePick()
  ];
}
