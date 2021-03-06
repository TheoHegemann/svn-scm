import * as cp from "child_process";
import { EventEmitter } from "events";
import * as iconv from "iconv-lite";
import isUtf8 = require("is-utf8");
import * as jschardet from "jschardet";
import { workspace } from "vscode";
import { ICpOptions, IExecutionResult, ISvnOptions } from "./common/types";
import { configuration } from "./helpers/configuration";
import { parseInfoXml } from "./infoParser";
import SvnError from "./svnError";
import { Repository } from "./svnRepository";
import { dispose, IDisposable, toDisposable } from "./util";

export const svnErrorCodes: { [key: string]: string } = {
  AuthorizationFailed: "E170001",
  RepositoryIsLocked: "E155004",
  NotASvnRepository: "E155007",
  NotShareCommonAncestry: "E195012",
  WorkingCopyIsTooOld: "E155036"
};

function getSvnErrorCode(stderr: string): string | undefined {
  for (const name in svnErrorCodes) {
    if (svnErrorCodes.hasOwnProperty(name)) {
      const code = svnErrorCodes[name];
      const regex = new RegExp(`svn: ${code}`);
      if (regex.test(stderr)) {
        return code;
      }
    }
  }

  if (/No more credentials or we tried too many times/.test(stderr)) {
    return svnErrorCodes.AuthorizationFailed;
  }

  return void 0;
}

export function cpErrorHandler(
  cb: (reason?: any) => void
): (reason?: any) => void {
  return err => {
    if (/ENOENT/.test(err.message)) {
      err = new SvnError({
        error: err,
        message: "Failed to execute svn (ENOENT)",
        svnErrorCode: "NotASvnRepository"
      });
    }

    cb(err);
  };
}

export class Svn {
  private svnPath: string;
  private version: string;
  private lastCwd: string = "";

  private _onOutput = new EventEmitter();
  get onOutput(): EventEmitter {
    return this._onOutput;
  }

  constructor(options: ISvnOptions) {
    this.svnPath = options.svnPath;
    this.version = options.version;
  }

  private logOutput(output: string): void {
    this._onOutput.emit("log", output);
  }

  public async exec(
    cwd: string,
    args: any[],
    options: ICpOptions = {}
  ): Promise<IExecutionResult> {
    if (cwd) {
      this.lastCwd = cwd;
      options.cwd = cwd;
    }

    if (options.log !== false) {
      const argsOut = args.map(arg => (/ |^$/.test(arg) ? `'${arg}'` : arg));
      this.logOutput(
        `[${this.lastCwd.split(/[\\\/]+/).pop()}]$ svn ${argsOut.join(" ")}\n`
      );
    }

    if (options.username) {
      args.push("--username", options.username);
    }
    if (options.password) {
      args.push("--password", options.password);
    }

    let encoding = options.encoding || "utf8";
    delete options.encoding;

    const process = cp.spawn(this.svnPath, args, options);

    const disposables: IDisposable[] = [];

    const once = (
      ee: NodeJS.EventEmitter,
      name: string,
      fn: (...args: any[]) => void
    ) => {
      ee.once(name, fn);
      disposables.push(toDisposable(() => ee.removeListener(name, fn)));
    };

    const on = (
      ee: NodeJS.EventEmitter,
      name: string,
      fn: (...args: any[]) => void
    ) => {
      ee.on(name, fn);
      disposables.push(toDisposable(() => ee.removeListener(name, fn)));
    };

    const [exitCode, stdout, stderr] = await Promise.all<any>([
      new Promise<number>((resolve, reject) => {
        once(process, "error", reject);
        once(process, "exit", resolve);
      }),
      new Promise<Buffer>(resolve => {
        const buffers: Buffer[] = [];
        on(process.stdout, "data", (b: Buffer) => buffers.push(b));
        once(process.stdout, "close", () => resolve(Buffer.concat(buffers)));
      }),
      new Promise<string>(resolve => {
        const buffers: Buffer[] = [];
        on(process.stderr, "data", (b: Buffer) => buffers.push(b));
        once(process.stderr, "close", () =>
          resolve(Buffer.concat(buffers).toString())
        );
      })
    ]);

    dispose(disposables);

    // SVN with '--xml' always return 'UTF-8', and jschardet detects this encoding: 'TIS-620'
    if (args.includes("--xml")) {
      encoding = "utf8";
    } else {
      const defaultEncoding = configuration.get<string>("default.encoding");
      if (defaultEncoding) {
        if (!iconv.encodingExists(defaultEncoding)) {
          this.logOutput(
            "svn.default.encoding: Invalid Parameter: '" +
              defaultEncoding +
              "'.\n"
          );
        } else if (!isUtf8(stdout)) {
          encoding = defaultEncoding;
        }
      } else {
        jschardet.MacCyrillicModel.mTypicalPositiveRatio += 0.001;

        const encodingGuess = jschardet.detect(stdout);

        if (
          encodingGuess.confidence > 0.8 &&
          iconv.encodingExists(encodingGuess.encoding)
        ) {
          encoding = encodingGuess.encoding;
        }
      }
    }

    const decodedStdout = iconv.decode(stdout, encoding);

    if (options.log !== false && stderr.length > 0) {
      this.logOutput(`${stderr}\n`);
    }

    if (exitCode) {
      return Promise.reject<IExecutionResult>(
        new SvnError({
          message: "Failed to execute svn",
          stdout: decodedStdout,
          stderr,
          stderrFormated: stderr.replace(/^svn: E\d+: +/gm, ""),
          exitCode,
          svnErrorCode: getSvnErrorCode(stderr),
          svnCommand: args[0]
        })
      );
    }

    return { exitCode, stdout: decodedStdout, stderr };
  }

  public async getRepositoryRoot(path: string) {
    try {
      const result = await this.exec(path, ["info", "--xml"]);

      const info = await parseInfoXml(result.stdout);

      if (info && info.wcInfo && info.wcInfo.wcrootAbspath) {
        return info.wcInfo.wcrootAbspath;
      }

      // SVN 1.6 not has "wcroot-abspath"
      return path;
    } catch (error) {
      if (error instanceof SvnError) {
        throw error;
      }
      console.error(error);
      throw new Error("Unable to find repository root path");
    }
  }

  public open(repositoryRoot: string, workspaceRoot: string): Repository {
    return new Repository(this, repositoryRoot, workspaceRoot);
  }
}
