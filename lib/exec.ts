import { exec } from "node:child_process";

export type RunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  ms: number;
};

// Promisified shell exec with a hard timeout. Used by route handlers to shell
// the real sources (ssh, pm2, python, gh). Never surfaces secrets: callers pass
// fixed commands, no client input is interpolated.
export function run(
  command: string,
  opts: { timeoutMs?: number; cwd?: string } = {},
): Promise<RunResult> {
  const { timeoutMs = 12000, cwd } = opts;
  const started = Date.now();
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: timeoutMs, cwd, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
        resolve({
          ok: !err,
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          code,
          ms: Date.now() - started,
        });
      },
    );
  });
}

// Standard BatchMode ssh prefix: never prompt, fail fast, use existing keys.
export function sshCmd(host: string, remote: string, connectTimeout = 6): string {
  const safeRemote = remote.replace(/'/g, "'\\''");
  return `ssh -o BatchMode=yes -o ConnectTimeout=${connectTimeout} ${host} '${safeRemote}'`;
}
