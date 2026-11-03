import { describe, expect, it } from 'vitest';
import { PoolSessionRoutes } from '../src/pool/session.js';
describe('pool conversation affinity', () => {
  it('pins only a successful eligible route on the same branch', () => {
    const sessions = new PoolSessionRoutes();
    const routes = [{ id: 'a' }, { id: 'b' }];
    sessions.begin('thread1/branch1', routes).succeed('b');
    expect(sessions.begin('thread1/branch1', routes).routes[0].id).toBe('b');
    expect(sessions.begin('thread1/branch2', routes).routes[0].id).toBe('a');
    expect(sessions.begin('thread1/branch1', [routes[0]]).routes[0].id).toBe('a');
    expect(sessions.begin(undefined, routes).routes[0].id).toBe('a');
  });
  it('does not let an older concurrent operation replace a newer pin', () => {
    const sessions = new PoolSessionRoutes();
    const routes = [{ id: 'a' }, { id: 'b' }];
    const old = sessions.begin('scope', routes);
    sessions.begin('scope', routes).succeed('b');
    old.succeed('a');
    expect(sessions.begin('scope', routes).routes[0].id).toBe('b');
  });

  it('preserves membership order when a pin is no longer admitted', () => {
    const sessions = new PoolSessionRoutes();
    const routes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    sessions.begin('branch', routes).succeed('b');
    // Dispatch applies current eligibility before begin(). A removed pin must not
    // reorder or synthesize a route the caller did not admit.
    expect(sessions.begin('branch', [{ id: 'a' }, { id: 'c' }]).routes.map(route => route.id))
      .toEqual(['a', 'c']);
    expect(sessions.begin('branch', [{ id: 'a' }, { id: 'c-2' }]).routes.map(route => route.id))
      .toEqual(['a', 'c-2']);
  });

  it('is stateless without a verified scope', () => {
    const sessions = new PoolSessionRoutes();
    const routes = [{ id: 'a' }, { id: 'b' }];
    sessions.begin(undefined, routes).succeed('b');
    expect(sessions.begin(undefined, routes).routes[0].id).toBe('a');
  });

  it('expires pins, bounds retention and refuses a success outside admitted routes', () => {
    let now = 0;
    const sessions = new PoolSessionRoutes(10, 1, () => now);
    const routes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    sessions.begin('one', routes).succeed('b');
    expect(sessions.begin('one', routes).routes[0].id).toBe('b');
    sessions.begin('two', routes).succeed('c');
    expect(sessions.begin('one', routes).routes[0].id).toBe('a');
    sessions.begin('one', routes).succeed('b');
    now = 11;
    expect(sessions.begin('one', routes).routes[0].id).toBe('a');
  });

  it('keeps caller priority among eligible alternatives without a membership cap', () => {
    const sessions = new PoolSessionRoutes();
    const many = Array.from({ length: 200 }, (_, index) => ({ id: 'account-' + index + '/rev1/model' }));
    sessions.begin('branch', many).succeed(many[199].id);
    const eligible = sessions.begin('branch', many.filter(route => route.id !== many[0].id));
    expect(eligible.routes).toHaveLength(199);
    expect(eligible.routes[0].id).toBe(many[199].id);
    expect(eligible.routes[1].id).toBe(many[1].id);
  });
});
