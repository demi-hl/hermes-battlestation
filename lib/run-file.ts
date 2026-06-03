import { execFile } from "node:child_process";

export type RunFileResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  ms: number;
};

/**
 * `execFile`-based runner: the binary + each argument are passed as a real argv
 * (no shell), so values that originate from git output or the filesystem can
 * never be interpolated into a command string. Repos/branches are server-derived
 * but this keeps the blast radius zero regardless. Pair it with `run()` (shell)
 * only for fixed, argument-free commands.
 */
export function runFile(
  file: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; maxBuffer?: number } = {},
): Promise<RunFileResult> {
  const { timeoutMs = 10_000, cwd, maxBuffer = 8 * 1024 * 1024 } = opts;
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, cwd, maxBuffer, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === "number"
            ? ((err as { code: number }).code)
            : err
              ? 1
              : 0;
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
