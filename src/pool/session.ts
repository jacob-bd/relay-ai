/** Scope must come from verified conversation/branch metadata, never prompt text. */
export class PoolSessionRoutes {
  private readonly states = new Map<string, { token: symbol; pinned?: string; expires: number }>();
  constructor(private readonly ttlMs = 3_600_000, private readonly capacity = 256, private readonly now = Date.now) {}
  begin<T extends { id: string }>(scope: string | undefined, eligible: readonly T[]) {
    const routes = [...eligible];
    if (!scope) return { routes, succeed: (_id: string) => {} };
    const previous = this.states.get(scope);
    const pinned = previous && previous.expires > this.now() ? previous.pinned : undefined;
    const state = { token: Symbol(), pinned, expires: this.now() + this.ttlMs };
    this.states.delete(scope);
    this.states.set(scope, state);
    while (this.states.size > this.capacity) this.states.delete(this.states.keys().next().value!);
    const index = routes.findIndex(route => route.id === pinned);
    if (index > 0) routes.unshift(...routes.splice(index, 1));
    return {
      routes,
      succeed: (id: string) => {
        if (this.states.get(scope)?.token !== state.token || !routes.some(route => route.id === id)) return;
        this.states.set(scope, { ...state, pinned: id, expires: this.now() + this.ttlMs });
      },
    };
  }
}
