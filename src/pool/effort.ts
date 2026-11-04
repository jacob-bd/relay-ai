/**
 * The one rule for what effort a pool member is sent, shared by every tool (Claude Code, Codex, future ones).
 *
 * Each tool sends whatever level it likes (Claude Code a rung such as "medium", Codex "high"), and the pool
 * never refuses a request over it. A member gets the level only when its receipt verified that exact rung;
 * otherwise the field is omitted (`null`) and the member runs on its provider default. Deciding this per tool
 * is how the pool once dropped every member for Codex after Claude had been fixed.
 */
export function poolMemberEffort(
  requested: string | undefined,
  receipt: { effortLevels: readonly string[] },
): string | null {
  if (!requested || requested === 'auto') return null;
  return receipt.effortLevels.includes(requested) ? requested : null;
}
