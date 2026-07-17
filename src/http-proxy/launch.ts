import { launchClaude } from '../launch.js';
import type { FavoriteModel, LocalProvider } from '../types.js';
import {
  buildHttpProxyChildEnv,
  findUnsupportedInheritedProxy,
  unsupportedInheritedProxyError,
} from './env.js';
import {
  startConfiguredHttpProxy,
  type ConfiguredHttpProxy,
} from './index.js';

export interface TransparentClaudeLaunchOptions {
  providers: LocalProvider[];
  favorites: FavoriteModel[];
  selected?: FavoriteModel;
  baseEnv: NodeJS.ProcessEnv;
  claudeArgs: string[];
  debug?: boolean;
  onProxyReady?: (proxy: ConfiguredHttpProxy) => void;
}

export interface TransparentClaudeLaunchResult {
  exitCode: number;
  proxy: ConfiguredHttpProxy;
}

interface LaunchDependencies {
  start: typeof startConfiguredHttpProxy;
  launch: typeof launchClaude;
}

const defaultDependencies: LaunchDependencies = {
  start: startConfiguredHttpProxy,
  launch: launchClaude,
};

export async function launchClaudeWithHttpProxy(
  options: TransparentClaudeLaunchOptions,
  dependencies: LaunchDependencies = defaultDependencies,
): Promise<TransparentClaudeLaunchResult> {
  const inheritedProxy = findUnsupportedInheritedProxy(options.baseEnv);
  if (inheritedProxy) {
    throw unsupportedInheritedProxyError(inheritedProxy);
  }

  const proxy = await dependencies.start({
    providers: options.providers,
    favorites: options.favorites,
    selected: options.selected,
    debug: options.debug,
    additionalCaCertPath: options.baseEnv['NODE_EXTRA_CA_CERTS'],
  });
  try {
    if (options.selected && !proxy.startingModel) {
      throw new Error(
        'The selected Relay model is unavailable, unsupported, or missing its provider credential.',
      );
    }
    options.onProxyReady?.(proxy);
    const childEnv = buildHttpProxyChildEnv(
      options.baseEnv,
      proxy.handle.proxyUrl,
      proxy.handle.caCertPath,
    );
    const exitCode = await dependencies.launch(
      childEnv,
      proxy.startingModel,
      options.claudeArgs,
    );
    return { exitCode, proxy };
  } finally {
    await proxy.handle.close();
  }
}
