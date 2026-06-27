// src/oauth/callback-server.ts — CLI fallback local callback server for PKCE OAuth flows.
// Primary path: the GUI server handles /oauth/callback when the UI is open.
// This is only used when running `relay-ai providers auth <provider>` without the GUI.

import http from 'node:http';

export interface CallbackParams {
  code: string;
  state: string;
  error?: string;
}

export interface CallbackServer {
  port: number;
  redirectUri: string;
  waitForCallback(timeoutMs?: number): Promise<CallbackParams>;
  close(): void;
}

const SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authorized</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)">
<div style="color:#22c55e;font-size:2.5rem">&#10003;</div>
<h1 style="margin:.5rem 0">Authentication successful</h1>
<p style="color:#666">You can close this tab and return to the terminal.</p>
</div></body></html>`;

export function startCallbackServer(): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let codeResolve: ((p: CallbackParams) => void) | undefined;
    let codeReject: ((e: Error) => void) | undefined;

    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://localhost');
      if (u.pathname !== '/callback' && u.pathname !== '/oauth/callback') {
        res.writeHead(404); res.end(); return;
      }
      const code = u.searchParams.get('code') ?? '';
      const state = u.searchParams.get('state') ?? '';
      const error = u.searchParams.get('error') ?? '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SUCCESS_HTML);
      codeResolve?.({ code, state, error: error || undefined });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const port = addr.port;
      resolve({
        port,
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCallback(timeoutMs = 300_000) {
          return new Promise<CallbackParams>((res, rej) => {
            codeResolve = res;
            codeReject = rej;
            setTimeout(
              () => rej(new Error('OAuth timeout — browser closed without completing sign-in')),
              timeoutMs,
            );
          });
        },
        close() { server.close(); codeReject?.(new Error('Server closed')); },
      });
    });

    server.on('error', reject);
  });
}
