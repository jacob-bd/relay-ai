// src/gemini-proxy.ts — Local Gemini-to-SDK translation proxy
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { streamText, generateText, tool, jsonSchema } from 'ai';
import type { LanguageModel } from 'ai';
import { readBody, sendJson } from './http-utils.js';
import { createLanguageModel } from './provider-factory.js';
import { silenceSdkWarnings } from './sdk-adapter.js';
import { getGeminiProxyDebugLogPath, makeTraceLogger } from './trace-log.js';
import type { ProxyRoute, ProxyHandle } from './proxy.js';
import { routeLookupIds } from './context-model-id.js';

function mapFinishReason(reason: string): string {
  if (reason === 'stop' || reason === 'tool-calls') return 'STOP';
  if (reason === 'length') return 'MAX_TOKENS';
  if (reason === 'content-filter') return 'SAFETY';
  return 'OTHER';
}

function lookupGeminiRoute(routes: ProxyRoute[], requestedModel: string): ProxyRoute | undefined {
  const ids = [requestedModel, ...routeLookupIds(requestedModel)];
  
  // Also support stripping prefixes/suffixes
  const slashIdx = requestedModel.indexOf('/');
  if (slashIdx >= 0) {
    const after = requestedModel.slice(slashIdx + 1);
    ids.push(after, ...routeLookupIds(after));
  }
  const doubleUnderscore = requestedModel.indexOf('__');
  if (doubleUnderscore >= 0) {
    const after = requestedModel.slice(doubleUnderscore + 2);
    ids.push(after, ...routeLookupIds(after));
  }

  const uniqueIds = [...new Set(ids)];
  for (const id of uniqueIds) {
    const route = routes.find(r => r.aliasId === id || r.realModelId === id);
    if (route) return route;
  }
  return undefined;
}

function mergeConsecutiveMessages(messages: any[]): any[] {
  const merged: any[] = [];
  for (const msg of messages) {
    if (merged.length === 0) {
      merged.push(msg);
      continue;
    }
    const last = merged[merged.length - 1];
    if (last.role === msg.role) {
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }];
      const nextContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
      last.content = [...lastContent, ...nextContent];
    } else {
      merged.push(msg);
    }
  }
  return merged;
}

export function translateGeminiRequest(body: any): any {
  // 1. System instruction
  let system: string | undefined;
  if (body.systemInstruction?.parts) {
    system = body.systemInstruction.parts.map((p: any) => p.text || '').join('\n');
  }

  // 2. Messages (contents)
  const messages: any[] = [];
  const nameToIdList = new Map<string, string[]>();

  const contents = body.contents || [];
  for (const turn of contents) {
    const role = turn.role === 'model' ? 'assistant' : 'user';
    const parts: any[] = [];
    const toolResults: any[] = [];

    const turnParts = turn.parts || [];
    for (const p of turnParts) {
      if (p.text !== undefined) {
        if (p.text.includes('<thinking>') && p.text.includes('</thinking>')) {
          const regex = /<thinking>([\s\S]*?)<\/thinking>/g;
          let lastIndex = 0;
          let match;
          while ((match = regex.exec(p.text)) !== null) {
            if (match.index > lastIndex) {
              const textBefore = p.text.substring(lastIndex, match.index).trim();
              if (textBefore) parts.push({ type: 'text', text: textBefore });
            }
            const thinkingText = match[1].trim();
            if (thinkingText) {
              parts.push({ type: 'reasoning', text: thinkingText });
            }
            lastIndex = regex.lastIndex;
          }
          if (lastIndex < p.text.length) {
            const textAfter = p.text.substring(lastIndex).trim();
            if (textAfter) parts.push({ type: 'text', text: textAfter });
          }
        } else {
          parts.push({ type: 'text', text: p.text });
        }
      } else if (p.inlineData) {
        parts.push({
          type: 'image',
          image: Buffer.from(p.inlineData.data, 'base64'),
          mediaType: p.inlineData.mimeType,
        });
      } else if (p.functionCall) {
        const id = 'call_' + randomUUID().replace(/-/g, '');
        const name = p.functionCall.name;
        if (!nameToIdList.has(name)) nameToIdList.set(name, []);
        nameToIdList.get(name)!.push(id);

        parts.push({
          type: 'tool-call',
          toolCallId: id,
          toolName: name,
          input: p.functionCall.args || {},
        });
      } else if (p.functionResponse) {
        const name = p.functionResponse.name;
        const idList = nameToIdList.get(name) || [];
        const id = idList.shift() || ('call_' + randomUUID().replace(/-/g, ''));
        
        toolResults.push({
          type: 'tool-result',
          toolCallId: id,
          toolName: name,
          output: {
            type: 'text',
            value: typeof p.functionResponse.response === 'string'
              ? p.functionResponse.response
              : JSON.stringify(p.functionResponse.response || {}),
          },
        });
      }
    }

    if (toolResults.length > 0) {
      messages.push({
        role: 'tool',
        content: toolResults,
      });
    }
    if (parts.length > 0) {
      messages.push({
        role,
        content: parts,
      });
    }
  }

  // Merge consecutive user/assistant/tool messages
  const mergedMessages = mergeConsecutiveMessages(messages);

  // 3. Tools translation
  let tools: any;
  if (body.tools) {
    tools = {};
    for (const t of body.tools) {
      if (t.functionDeclarations) {
        for (const fd of t.functionDeclarations) {
          tools[fd.name] = tool({
            description: fd.description || '',
            inputSchema: jsonSchema(fd.parameters || { type: 'object', properties: {} }),
          });
        }
      }
    }
  }

  // 4. Tool Choice
  let toolChoice: any;
  const mode = body.toolConfig?.functionCallingConfig?.mode;
  if (mode === 'ANY') {
    toolChoice = 'required';
  } else if (mode === 'AUTO') {
    toolChoice = 'auto';
  }

  const generationConfig = body.generationConfig || {};
  let responseFormat: { type: 'json' } | undefined;
  if (generationConfig.responseMimeType === 'application/json') {
    responseFormat = { type: 'json' };
  }

  return {
    system,
    messages: mergedMessages,
    tools: tools && Object.keys(tools).length > 0 ? tools : undefined,
    toolChoice,
    maxOutputTokens: generationConfig.maxOutputTokens,
    temperature: generationConfig.temperature,
    responseFormat,
  };
}

export async function startGeminiProxy(
  routes: ProxyRoute[],
  debug = false,
): Promise<ProxyHandle> {
  const proxyToken = randomUUID();
  silenceSdkWarnings();

  if (routes.length === 0) {
    return Promise.reject(new Error('Gemini proxy requires at least one route'));
  }

  const defaultRoute = routes[0]!;
  const models = new Map<string, LanguageModel>();
  const plog = debug ? makeTraceLogger(getGeminiProxyDebugLogPath()) : () => {};

  const onRejection = (reason: unknown) => {
    plog(`Unhandled Rejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  };
  const onException = (error: Error) => {
    plog(`Uncaught Exception: ${error.stack || error.message}`);
  };

  // Helper to lazily resolve language model when needed
  const getOrInitModel = async (route: ProxyRoute): Promise<LanguageModel> => {
    let m = models.get(route.aliasId);
    if (!m) {
      m = await createLanguageModel({
        npm: route.npm || '@ai-sdk/openai-compatible',
        modelId: route.realModelId,
        apiKey: route.apiKey,
        baseURL: route.baseURL,
        providerId: route.aliasId,
        authType: route.authType,
        oauthAccountId: route.oauthAccountId,
      });
      models.set(route.aliasId, m);
    }
    return m;
  };

  const formatGeminiModel = (route: ProxyRoute) => ({
    name: `models/${route.aliasId}`,
    version: '1.0',
    displayName: route.displayName,
    description: 'Registry model routed through relay-ai proxy',
    inputTokenLimit: route.contextWindow || 1000000,
    outputTokenLimit: 8192,
    supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
  });

  let sessionRouteOverride: ProxyRoute | undefined = undefined;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = req.url ?? '';
      plog(`${req.method} ${url}`);

      // 1. GET /v1beta/models or /v1/models
      if (req.method === 'GET' && (url.endsWith('/models') || url.includes('/models?'))) {
        plog('GET models list');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const payload = JSON.stringify({
          models: routes.map(formatGeminiModel),
        });
        plog(`Response: ${payload}`);
        res.end(payload);
        return;
      }

      // 2. GET /v1beta/models/:model or /v1/models/:model
      if (req.method === 'GET' && url.includes('/models/')) {
        const modelMatch = url.match(/\/models\/([^?]+)/);
        if (modelMatch) {
          const modelId = decodeURIComponent(modelMatch[1]);
          const route = lookupGeminiRoute(routes, modelId) ?? defaultRoute;
          plog(`GET model details: ${modelId} -> mapped to route ${route.aliasId}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const payload = JSON.stringify(formatGeminiModel(route));
          plog(`Response: ${payload}`);
          res.end(payload);
          return;
        }
      }

      // 3. POST Generate content (streaming or non-streaming)
      if (req.method === 'POST' && url.includes(':')) {
        const isStream = url.includes('streamGenerateContent');
        const rawBody = await readBody(req);
        plog(`Request body:\n${rawBody}`);
        let body: any;
        try {
          body = JSON.parse(rawBody);
        } catch {
          plog('Error: Invalid JSON body');
          res.writeHead(400);
          res.end('Invalid JSON');
          return;
        }

        const modelMatch = url.match(/\/models\/([^:]+)/);
        const requestedModel = modelMatch ? decodeURIComponent(modelMatch[1]) : defaultRoute.aliasId;

        // --- Model Switch Intercept ---
        const lastUserTurn = findLastUserTurn(body.contents || []);
        const modelCommand = parseModelCommand(lastUserTurn);

        if (modelCommand !== null) {
          if (modelCommand === '') {
            // .model with no args — show current model and available list
            const current = sessionRouteOverride ?? (lookupGeminiRoute(routes, requestedModel) ?? defaultRoute);
            const availableList = routes.map(r => `  - ${r.aliasId} (${r.displayName})`).join('\n');
            const exampleId = routes.length > 1 ? routes[1].aliasId : (routes[0]?.aliasId ?? 'deepseek-v4');
            const text = `Current model: ${current.displayName} (${current.aliasId})\n\nAvailable models:\n${availableList}\n\n💡 To switch models, type: .model <id>\nExample: .model ${exampleId}`;
            sendMockGeminiResponse(res, text, isStream);
            return;
          }

          const targetRoute = lookupGeminiRoute(routes, modelCommand);
          if (targetRoute) {
            sessionRouteOverride = targetRoute;
            plog(`.model switch: ${targetRoute.aliasId} (${targetRoute.realModelId})`);
            sendMockGeminiResponse(res, `✅ Switched model to ${targetRoute.displayName} (${targetRoute.aliasId})`, isStream);
          } else {
            const available = routes.map(r => r.aliasId).join(', ');
            sendMockGeminiResponse(res, `❌ Model '${modelCommand}' not found.\n\nAvailable: ${available}`, isStream);
          }
          return;
        }

        const route = sessionRouteOverride ?? (lookupGeminiRoute(routes, requestedModel) ?? defaultRoute);
        plog(`Route selected: ${route.aliasId} (upstream model: ${route.realModelId})`);

        body.contents = sanitizeModelSwitchTurns(body.contents || []);

        const languageModel = await getOrInitModel(route);
        const params = translateGeminiRequest(body);
        plog(`Translated SDK params:\n${JSON.stringify(params, null, 2)}`);

        if (isStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          plog('Starting streamText...');
          const { fullStream } = streamText({
            model: languageModel,
            ...params,
          });

          const toolCallBuffers = new Map<string, { name: string; json: string }>();
          let isThinking = false;

          for await (const part of fullStream) {
            const p = part as any;
            plog(`Stream chunk type: ${p.type}`);
            
            // Auto-close thinking tag if moving to tool calls or finish
            if (isThinking && (p.type === 'tool-input-start' || p.type === 'tool-call' || p.type === 'finish')) {
              isThinking = false;
              const chunk = {
                candidates: [{ content: { role: 'model', parts: [{ text: `\n</thinking>\n\n` }] } }]
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }

            if (p.type === 'reasoning') {
              let text = p.textDelta ?? p.text ?? '';
              if (!isThinking) {
                isThinking = true;
                text = `<thinking>\n` + text;
              }
              const chunk = {
                candidates: [{ content: { role: 'model', parts: [{ text }] } }]
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            } else if (p.type === 'text-delta') {
              let text = p.textDelta ?? p.text ?? '';
              if (isThinking) {
                isThinking = false;
                text = `\n</thinking>\n\n` + text;
              }
              const chunk = {
                candidates: [{
                  content: {
                    role: 'model',
                    parts: [{ text }]
                  }
                }]
              };
              const data = `data: ${JSON.stringify(chunk)}\n\n`;
              plog(`Streaming text delta: ${p.textDelta}`);
              res.write(data);
            } else if (p.type === 'tool-input-start') {
              toolCallBuffers.set(p.toolCallId, { name: p.toolName, json: '' });
            } else if (p.type === 'tool-input-delta') {
              const buf = toolCallBuffers.get(p.toolCallId);
              if (buf) buf.json += p.delta;
            } else if (p.type === 'tool-call') {
              const buf = toolCallBuffers.get(p.toolCallId);
              const args = buf ? JSON.parse(buf.json || '{}') : (p.input || {});
              const name = buf ? buf.name : p.toolName;
              plog(`Streaming tool call: ${name} with args: ${JSON.stringify(args)}`);
              
              const chunk = {
                candidates: [{
                  content: {
                    role: 'model',
                    parts: [{
                      functionCall: { name, args }
                    }]
                  }
                }]
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            } else if (p.type === 'finish') {
              const chunk = {
                candidates: [{
                  finishReason: mapFinishReason(p.finishReason ?? '')
                }],
                usageMetadata: {
                  promptTokenCount: p.totalUsage?.inputTokens || 0,
                  candidatesTokenCount: p.totalUsage?.outputTokens || 0,
                }
              };
              plog(`Stream finish. Reason: ${p.finishReason}`);
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          }
          res.end();
          plog('Stream ended.');
        } else {
          // Non-streaming generateContent
          plog('Starting generateText...');
          const result = await generateText({
            model: languageModel,
            ...params,
          });
          plog('generateText finished.');

          const parts: any[] = [];
          if (result.reasoning) {
            parts.push({ text: `<thinking>\n${result.reasoning}\n</thinking>\n\n` });
          }
          if (result.text) {
            parts.push({ text: result.text });
          }
          if (result.toolCalls?.length) {
            for (const tc of result.toolCalls) {
              parts.push({
                functionCall: { name: tc.toolName, args: (tc as any).args }
              });
            }
          }

          const response = {
            candidates: [{
              content: {
                role: 'model',
                parts,
              },
              finishReason: mapFinishReason(result.finishReason ?? '')
            }],
            usageMetadata: {
              promptTokenCount: result.usage?.inputTokens || 0,
              candidatesTokenCount: result.usage?.outputTokens || 0,
            }
          };

          plog(`Response:\n${JSON.stringify(response, null, 2)}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        }
        return;
      }

      plog(`404 Not Found: ${url}`);
      res.writeHead(404);
      res.end('Not Found');
    } catch (err) {
      plog(`Error handling request: ${err instanceof Error ? err.stack || err.message : String(err)}`);
      if (debug) {
        console.error('[Gemini Proxy] Critical error in handler:', err);
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: errMsg } }));
      } else {
        // Headers already sent — we're mid-SSE stream; emit an error event before closing
        try {
          res.write(`data: ${JSON.stringify({ error: { message: errMsg } })}\n\n`);
        } catch {
          // ignore write errors on a closing socket
        }
        res.end();
      }
    }
  });

  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);

  const cleanup = () => {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
  };

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      cleanup();
      reject(err);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        cleanup();
        reject(new Error('Failed to bind gemini proxy'));
        return;
      }
      resolve({
        port: addr.port,
        token: proxyToken,
        close: () => {
          cleanup();
          server.close();
        },
      });
    });
  });
}

export function sanitizeModelSwitchTurns(contents: any[]): any[] {
  const cleaned: any[] = [];
  let i = 0;
  while (i < contents.length) {
    const turn = contents[i];
    if (isModelSwitchTurn(turn)) {
      // Skip this user turn and the next model turn (the fake response)
      i += 1;
      if (i < contents.length && contents[i]?.role === 'model') {
        i += 1; // skip the paired model response
      }
      continue;
    }
    cleaned.push(turn);
    i += 1;
  }
  return cleaned;
}

export function isModelSwitchTurn(turn: any): boolean {
  if (turn?.role !== 'user') return false;
  const parts = turn.parts || [];
  if (parts.length === 0) return false;
  const firstText = parts[0]?.text;
  if (typeof firstText !== 'string') return false;
  return firstText.trim().startsWith('.model');
}

export function findLastUserTurn(contents: any[]): any | undefined {
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i]?.role === 'user') return contents[i];
  }
  return undefined;
}

export function parseModelCommand(turn: any): string | null {
  if (!turn || turn.role !== 'user') return null;
  const parts = turn.parts || [];
  if (parts.length !== 1) return null; // Must be a single-part message
  const text = parts[0]?.text;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('.model')) return null;
  if (trimmed === '.model') return ''; // no args
  if (trimmed.charAt(6) !== ' ') return null; // ".modelfoo" is not a command
  return trimmed.slice(7).trim();
}

function sendMockGeminiResponse(res: ServerResponse, text: string, isStream: boolean): void {
  if (isStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const chunk = {
      candidates: [{
        content: { role: 'model', parts: [{ text }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    const finishChunk = {
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 }
    };
    res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
    res.end();
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      candidates: [{
        content: { role: 'model', parts: [{ text }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
    }));
  }
}
