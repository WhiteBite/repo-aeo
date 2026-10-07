import { spawnSync } from 'node:child_process';

/** Runs a command synchronously and returns { ok, stdout, stderr, code }. Never throws. */
export function run(cmd, args = [], { cwd = process.cwd(), timeout = 20000, env = process.env, shell = false, input } = {}) {
  try {
    const result = spawnSync(cmd, args, {
      cwd,
      timeout,
      encoding: 'utf8',
      env,
      shell,
      maxBuffer: 32 * 1024 * 1024,
      input,
    });
    if (result.error) {
      return { ok: false, stdout: '', stderr: String(result.error.message), code: null, missing: result.error.code === 'ENOENT' };
    }
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      code: result.status,
      missing: false,
    };
  } catch (error) {
    return { ok: false, stdout: '', stderr: String(error && error.message), code: null, missing: false };
  }
}

// On Windows npm is npm.cmd; spawnSync does not apply PATHEXT without a shell.
export function npmBinary() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
