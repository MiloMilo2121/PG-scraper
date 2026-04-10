import * as dotenv from 'dotenv';
import * as path from 'path';

export interface RuntimeBootstrapOptions {
  cwd?: string;
  envPath?: string;
  override?: boolean;
  quiet?: boolean;
  reload?: boolean;
}

let initialized = false;
let lastEnvPath: string | null = null;

export function initializeRuntimeEnvironment(options: RuntimeBootstrapOptions = {}): string {
  if (initialized && !options.reload) {
    return lastEnvPath || resolveEnvPath(options);
  }

  const envPath = resolveEnvPath(options);
  dotenv.config({
    path: envPath,
    override: options.override ?? false,
    quiet: options.quiet ?? true,
  });

  initialized = true;
  lastEnvPath = envPath;
  return envPath;
}

export function resetRuntimeEnvironmentForTests(): void {
  initialized = false;
  lastEnvPath = null;
}

function resolveEnvPath(options: RuntimeBootstrapOptions): string {
  if (options.envPath) {
    return path.resolve(options.envPath);
  }

  return path.resolve(options.cwd || process.cwd(), '.env');
}
