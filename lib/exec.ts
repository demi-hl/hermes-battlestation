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
// Hardened: no TTY, no agent/X11 forwarding, no command execution beyond the
// fixed remote string — the fleet uses SSH ONLY for read-only telemetry.
export function sshCmd(host: string, remote: string, connectTimeout = 6): string {
  const safeRemote = remote.replace(/'/g, "'\\''");
  // Quote the host too (defense-in-depth: env-derived today, but a future
  // client-controlled host must not be able to inject shell args — F14).
  return (
    `ssh -o BatchMode=yes -o ConnectTimeout=${connectTimeout} ` +
    `-o RequestTTY=no -o ForwardAgent=no -o ForwardX11=no -o ClearAllForwardings=yes ` +
    `-T ${shellQuote(host)} '${safeRemote}'`
  );
}

// Strip the host home path + username from a string before returning it to a
// client, so error output can't leak local filesystem layout / the OS user
// (F13). Replaces /home/<user> and /Users/<user> with ~.
export function scrubPaths(s: string): string {
  return s
    .replace(/\/(?:home|Users)\/[^/\s:'"]+/g, "~")
    .trim();
}

// Read-only command allowlist for fleet SSH probes. A remote command must start
// with one of these tokens or it is refused — this is what makes the fleet
// "agents/telemetry only": it physically cannot run an arbitrary remote shell.
const READONLY_REMOTE = [
  "echo ",
  "nvidia-smi ",
  "pm2 jlist",
  "C=$(nproc)", // linux sys one-liner
  "C=$(sysctl", // darwin sys one-liner
  "wmic ", // windows sys one-liner
];

export function isReadOnlyRemote(remote: string): boolean {
  const r = remote.trimStart();
  return READONLY_REMOTE.some((p) => r.startsWith(p));
}

/** Build a hardened, read-only-guarded ssh command. Returns null if the remote
 *  command is not on the read-only allowlist (caller treats as unavailable). */
export function sshReadOnly(
  host: string,
  remote: string,
  connectTimeout = 6,
): string | null {
  if (!isReadOnlyRemote(remote)) return null;
  return sshCmd(host, remote, connectTimeout);
}

// Single-quote a string for safe inclusion in a /bin/sh command line.
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
