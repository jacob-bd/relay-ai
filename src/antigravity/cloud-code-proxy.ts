import zlib from 'node:zlib';

/**
 * Decode a compressed HTTP response body.
 *
 * @param buffer The raw response body
 * @param encoding The content-encoding header value (gzip, br, deflate, or empty)
 * @returns The decoded body as a Buffer
 */
export function decodeBody(buffer: Buffer, encoding: string): Buffer {
  const enc = encoding.toLowerCase().trim();
  if (enc === 'gzip') return zlib.gunzipSync(buffer);
  if (enc === 'br') return zlib.brotliDecompressSync(buffer);
  if (enc === 'deflate') return zlib.inflateSync(buffer);
  return buffer; // identity or unknown
}

/**
 * Encode a body with the specified content-encoding.
 *
 * @param buffer The plain body
 * @param encoding The desired content-encoding (gzip, br, deflate, or empty)
 * @returns The encoded body as a Buffer
 */
export function encodeBody(buffer: Buffer, encoding: string): Buffer {
  const enc = encoding.toLowerCase().trim();
  if (enc === 'gzip') return zlib.gzipSync(buffer);
  if (enc === 'br') return zlib.brotliCompressSync(buffer);
  if (enc === 'deflate') return zlib.deflateSync(buffer);
  return buffer; // identity or unknown
}

/**
 * Normalize response headers after modifying a body.
 *
 * This fixes the critical bug found during feasibility testing where
 * copying Google's response headers alongside a new Content-Length
 * produced both Content-Length and Transfer-Encoding, causing:
 *
 *   "Parse Error: Content-Length can't be present with Transfer-Encoding"
 *
 * @param headers The original response headers
 * @param output The modified response body (used to compute Content-Length)
 * @param stripEncoding If true, remove content-encoding (body was decoded to identity)
 * @returns Normalized headers safe to send to the client
 */
export function normalizeResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
  output: Buffer,
  stripEncoding = false,
): Record<string, string | string[] | undefined> {
  const result = { ...headers };

  // Set correct Content-Length for the modified body
  result['content-length'] = String(output.length);

  // Remove Transfer-Encoding — must never coexist with Content-Length
  delete result['transfer-encoding'];

  // Remove stale ETag — it no longer matches the modified body
  delete result.etag;

  // Remove content-encoding if the body was decoded to identity
  if (stripEncoding) {
    delete result['content-encoding'];
  }

  return result;
}
