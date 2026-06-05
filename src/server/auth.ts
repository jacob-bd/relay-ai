export function isAuthorized(request: Request, serverPassword: string | null): boolean {
  if (serverPassword === null) return true;

  const bearerToken = extractBearerToken(request.headers.get('authorization'));
  if (bearerToken === serverPassword) return true;

  return request.headers.get('x-api-key') === serverPassword;
}

function extractBearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}
