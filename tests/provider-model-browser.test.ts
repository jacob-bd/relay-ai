import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadBrowserHelpers() {
  const moduleUrl = new URL('../src/ui/public/provider-model-browser.js', import.meta.url);
  return import(/* @vite-ignore */ moduleUrl.href);
}

async function loadProviderLogoHelpers() {
  const moduleUrl = new URL('../src/ui/public/provider-logo.js', import.meta.url);
  return import(/* @vite-ignore */ moduleUrl.href);
}

describe('provider model browser', () => {
  const models = Array.from({ length: 55 }, (_, index) => ({
    id: `model-${index + 1}`,
    name: index === 30 ? 'Special Reasoning Model' : `Model ${index + 1}`,
  }));

  it('filters models by name or id without case sensitivity', async () => {
    const { filterProviderModels } = await loadBrowserHelpers();

    expect(filterProviderModels(models, 'SPECIAL')).toEqual([models[30]]);
    expect(filterProviderModels(models, 'model-12')).toEqual([models[11]]);
  });

  it('paginates models in groups of 25 and clamps invalid pages', async () => {
    const { getProviderModelPage } = await loadBrowserHelpers();

    expect(getProviderModelPage(models, '', 2)).toMatchObject({
      page: 2,
      totalPages: 3,
      total: 55,
      items: models.slice(25, 50),
    });
    expect(getProviderModelPage(models, '', 99).page).toBe(3);
  });

  it('formats input and output prices per million tokens when known', async () => {
    const { formatModelPrice } = await loadBrowserHelpers();

    expect(formatModelPrice({ input: 0.59, output: 15 })).toBe('$0.59 / $15.00');
    expect(formatModelPrice(undefined)).toBe('—');
  });

  it('uses the same brand logo markup for OAuth provider aliases', async () => {
    const { providerLogoHtml } = await loadProviderLogoHelpers();

    expect(providerLogoHtml('xai-oauth', 'xAI (SuperGrok)')).toContain('<svg');
    expect(providerLogoHtml('xai-oauth', 'xAI (SuperGrok)')).toBe(
      providerLogoHtml('xai', 'xAI'),
    );
    expect(providerLogoHtml('unknown-provider', 'Unknown Provider')).toBe('U');
  });

  it('uses the official Qwen mark for both Qwen Cloud billing providers', async () => {
    const { providerLogoHtml } = await loadProviderLogoHelpers();

    const tokenPlanLogo = providerLogoHtml(
      'qwen-cloud-token-plan',
      'Qwen Cloud (Token Plan)',
    );
    const paygLogo = providerLogoHtml(
      'qwen-cloud-payg',
      'Qwen Cloud (Pay-As-You-Go)',
    );

    expect(tokenPlanLogo).toBe(paygLogo);
    expect(tokenPlanLogo).toContain('<svg');
    expect(tokenPlanLogo).toContain('viewBox="0 0 141.38 140"');
    expect(tokenPlanLogo).toContain('fill="#6D44E8"');
    expect(tokenPlanLogo).toContain('m140.93 85-16.35-28.33');
  });

  it('links the sidebar brand to the main repository', () => {
    const htmlPath = fileURLToPath(new URL('../src/ui/public/index.html', import.meta.url));
    const html = readFileSync(htmlPath, 'utf8');

    expect(html).toContain('href="https://github.com/jacob-bd/relay-ai"');
    expect(html).toContain('aria-label="Open the relay-ai GitHub repository"');
  });
});
