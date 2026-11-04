// Claude Code treats third-party routes as 200K unless the model id ends with [1m].
import { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } from './context-window.js';

export const ONE_M_CONTEXT_SUFFIX = '[1m]';

/** Smallest window that earns the [1m] tag. Claude Code has only 200K and 1M for these routes. */
export const ONE_M_CONTEXT_WINDOW = 1_000_000;

/**
 * Window to give Claude Code for a model. An estimated size (custom endpoint, not reported, typed or
 * measured) is capped at the 200K default, so a wrong guess compacts early instead of overflowing.
 */
export function claudeCodeContextWindow(model: { id: string; contextWindow?: number; contextWindowEstimated?: boolean }): number {
  const window = resolveContextWindow(stripOneMContextSuffix(model.id), model.contextWindow);
  return model.contextWindowEstimated ? Math.min(window, DEFAULT_CONTEXT_WINDOW) : window;
}

export function stripOneMContextSuffix(modelId: string): string {
  return modelId.replace(/\[1m\]$/i, '');
}

export function hasOneMContextSuffix(modelId: string): boolean {
  return /\[1m\]$/i.test(modelId);
}

/**
 * Model id to pass to Claude Code (--model / ANTHROPIC_MODEL). Only 1M+ windows get [1m]: a 262K model
 * tagged 1M would not compact until near 1M and overflow the server. Without the tag Claude Code uses
 * CLAUDE_CODE_MAX_CONTEXT_TOKENS when set (single-model launches), otherwise 200K.
 */
export function claudeCodeClientModelId(modelId: string, contextWindow?: number): string {
  const bare = stripOneMContextSuffix(modelId);
  const window = resolveContextWindow(bare, contextWindow);
  if (window >= ONE_M_CONTEXT_WINDOW) {
    return `${bare}${ONE_M_CONTEXT_SUFFIX}`;
  }
  return bare;
}

/** Variants to match inbound Claude Code model ids against proxy catalog aliases. */
export function routeLookupIds(id: string): string[] {
  const bare = stripOneMContextSuffix(id);
  const googleBare = bare.startsWith('models/') ? bare.slice('models/'.length) : bare;
  return [...new Set([
    id,
    bare,
    `${bare}${ONE_M_CONTEXT_SUFFIX}`,
    googleBare,
    `${googleBare}${ONE_M_CONTEXT_SUFFIX}`,
    `models/${googleBare}`,
    `models/${bare}`,
  ])];
}
