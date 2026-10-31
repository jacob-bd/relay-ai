import { AsyncLocalStorage } from 'node:async_hooks';

// Request-local: model instances and fetch functions can be shared by concurrent turns.
export const streamActivity = new AsyncLocalStorage<() => void>();

export function activityFetch(upstream: typeof globalThis.fetch = (...args) => globalThis.fetch(...args)): typeof globalThis.fetch {
  return async (input, init) => {
    const activity = streamActivity.getStore();
    const response = await upstream(input, init);
    if (!activity || !response.body) return response;
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) { controller.close(); return; }
          if (value.byteLength) activity();
          controller.enqueue(value);
        } catch (error) { controller.error(error); }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
