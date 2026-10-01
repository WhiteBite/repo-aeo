import { spawn } from 'node:child_process';

const TIMEOUT_MS = 600000;
const STDERR_TAIL_CHARS = 8000;
const STDERR_TAIL_LINES = 30;

const argv = process.argv.slice(2);

if (argv.length === 0) {
  console.error('usage: node run-audit.mjs <command> [args...]');
  process.exitCode = 1;
} else {
  runAudit(argv);
}

function runAudit(argv) {
  const [command, ...args] = argv;
  const minScore = minScoreOf(argv);
  const stdio = ['inherit', 'inherit', 'pipe'];
  // win32: npx is npx.cmd and Node refuses to spawn .cmd shims without a shell
  const child = process.platform === 'win32'
    ? spawn([command, ...args].map(shellArg).join(' '), { stdio, shell: true })
    : spawn(command, args, { stdio });

  let tail = '';
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    tail = (tail + chunk).slice(-STDERR_TAIL_CHARS);
  });

  let timedOut = false;
  let settled = false;
  let forceExit = null;

  const timeout = setTimeout(() => {
    timedOut = true;
    console.error(`::error::audit command timed out after ${TIMEOUT_MS} ms`);
    child.kill('SIGKILL');
    forceExit = setTimeout(() => process.exit(1), 5000);
  }, TIMEOUT_MS);

  const finish = (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (forceExit) clearTimeout(forceExit);
    process.exitCode = code;
  };

  child.on('error', (err) => {
    if (settled) return;
    console.error(`::error::audit runner error: ${err.message}`);
    finish(1);
  });

  child.on('close', (code, signal) => {
    if (settled) return;
    if (timedOut) {
      finish(1);
    } else if (code === 0) {
      finish(0);
    } else if (code === 2) {
      console.error(minScore
        ? `::error::Discoverability score is below ${minScore}.`
        : '::error::Discoverability score is below the configured minimum.');
      finish(2);
    } else if (code === null) {
      console.error(`::error::audit command was killed by signal ${signal}`);
      finish(1);
    } else {
      console.error(`::error::audit command failed with exit code ${code}`);
      const lines = tail.split(/\r?\n/).filter((line) => line.trim() !== '');
      if (lines.length > 0) {
        console.error(`--- last ${Math.min(lines.length, STDERR_TAIL_LINES)} stderr line(s) ---`);
        for (const line of lines.slice(-STDERR_TAIL_LINES)) console.error(line);
      }
      finish(1);
    }
  });
}

function shellArg(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

function minScoreOf(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--min-score' && i + 1 < argv.length) return argv[i + 1];
    if (argv[i].startsWith('--min-score=')) return argv[i].slice('--min-score='.length);
  }
  return null;
}
