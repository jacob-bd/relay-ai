import spawn from 'cross-spawn';

export interface CodexCommandResult {
  stdout: string;
  stderr: string;
}

export interface CodexCommandOptions {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
}

function commandError(
  binaryPath: string,
  args: string[],
  stdout: string,
  stderr: string,
  detail: string,
): Error {
  const error = new Error(`Command failed: ${binaryPath} ${args.join(' ')} (${detail})`);
  return Object.assign(error, { stdout, stderr });
}

/**
 * Run an npm-installed Codex command without relying on Node's raw child-process
 * handling. cross-spawn resolves Windows .cmd shims while preserving argv.
 */
export function runCodexCommandSync(
  binaryPath: string,
  args: string[],
  options: CodexCommandOptions = {},
): CodexCommandResult {
  const result = spawn.sync(binaryPath, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.env,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (result.error) {
    throw Object.assign(result.error, { stdout, stderr });
  }
  if (result.status !== 0) {
    throw commandError(binaryPath, args, stdout, stderr, `exit ${result.status ?? result.signal ?? 'unknown'}`);
  }
  return { stdout, stderr };
}

export function runCodexCommand(
  binaryPath: string,
  args: string[],
  options: CodexCommandOptions = {},
): Promise<CodexCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finishError = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(Object.assign(error, {
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      }));
    };
    const collect = (target: Buffer[], chunk: Buffer): void => {
      target.push(chunk);
      outputBytes += chunk.length;
      if (options.maxBuffer !== undefined && outputBytes > options.maxBuffer) {
        child.kill();
        finishError(commandError(binaryPath, args, '', '', `output exceeded ${options.maxBuffer} bytes`));
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => collect(stdoutChunks, chunk));
    child.stderr?.on('data', (chunk: Buffer) => collect(stderrChunks, chunk));
    child.on('error', finishError);

    let timer: NodeJS.Timeout | undefined;
    if (options.timeout !== undefined) {
      timer = setTimeout(() => {
        child.kill();
        finishError(commandError(binaryPath, args, '', '', `timed out after ${options.timeout}ms`));
      }, options.timeout);
    }

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code !== 0) {
        finishError(commandError(binaryPath, args, stdout, stderr, `exit ${code ?? signal ?? 'unknown'}`));
        return;
      }
      settled = true;
      resolve({ stdout, stderr });
    });
  });
}
