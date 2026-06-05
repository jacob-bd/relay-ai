export type ServerModelFormat = 'anthropic' | 'openai' | 'unsupported';
export type ServerBackendId = 'zen' | 'go';

export interface ServerModelInfo {
  id: string;
  name: string;
  isFree: boolean;
  brand: string;
  sourceBackend: ServerBackendId;
  modelFormat: ServerModelFormat;
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
}

export interface ModelCatalog {
  get: (id: string) => ServerModelInfo | undefined;
  list: () => ServerModelInfo[];
}

const CREATED_AT_ISO = '2025-01-01T00:00:00Z';
const CREATED_AT_UNIX = 1735689600;

export function createModelCatalog(models: ServerModelInfo[]): ModelCatalog {
  const byId = new Map(models.map(model => [model.id, model]));

  return {
    get: (id: string) => byId.get(id),
    list: () => [...models],
  };
}

export function formatAnthropicModels(models: ServerModelInfo[]) {
  return {
    data: models.map(model => ({
      id: model.id,
      type: 'model',
      display_name: model.name,
      created_at: CREATED_AT_ISO,
    })),
    has_more: false,
    first_id: models[0]?.id ?? null,
    last_id: models.at(-1)?.id ?? null,
  };
}

export function formatOpenAIModels(models: ServerModelInfo[]) {
  return {
    object: 'list',
    data: models.map(model => ({
      id: model.id,
      object: 'model',
      created: CREATED_AT_UNIX,
      owned_by: model.sourceBackend,
    })),
  };
}
