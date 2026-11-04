import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

export function createMockRequest(method: string, url: string, body?: string): any {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { method, url, headers: {} });
  return req;
}

export function createMockResponse() {
  const result = { data: '', code: 200, headers: {} as Record<string, string> };
  const res: Partial<ServerResponse> = {
    writeHead(statusCode: number, headers?: any) {
      result.code = statusCode;
      if (headers) Object.assign(result.headers, headers);
      return this as any;
    },
    setHeader(name: string, value: any) {
      result.headers[name.toLowerCase()] = String(value);
      return this as any;
    },
    write(chunk: any) { result.data += chunk.toString(); return true; },
    // Handlers listen for client disconnect; a mock response never disconnects.
    on() { return this as any; },
    once() { return this as any; },
    removeListener() { return this as any; },
    end(chunk?: any) { if (chunk) result.data += chunk.toString(); return this as any; },
  };
  return { res: res as ServerResponse, result };
}
