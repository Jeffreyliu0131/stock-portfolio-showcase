import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePortfolioWireRequest, portfolioWireResponse } from '../application/ai/portfolio-wire-compatibility.ts';
import { requestPortfolioConsultation } from '../application/ai/browser/portfolio-consultation-client.ts';
import { parsePortfolioConsultationApiResponse, type PortfolioConsultationSuccess } from '../application/ai/portfolio-consultation-api.ts';
import { initialPortfolioConsultationRequest, initialPortfolioConsultationOutput } from './portfolio-consultation-fixtures.ts';
import { POST } from '../app/api/ai/portfolio-analysis/route.ts';
import { resetPortfolioAiRateLimitForTests } from '../application/http/public-route-rate-limiters.ts';
const model = vi.hoisted(() => ({ consult: vi.fn() }));
vi.mock('../application/ai/server/deepseek-portfolio-consultant.ts', async (importOriginal) => ({ ...await importOriginal<object>(), consultPortfolioWithDeepSeek: model.consult }));
const success = (): PortfolioConsultationSuccess => ({ kind: 'PORTFOLIO_CONSULTATION_RESULT', schemaVersion: 4, promptVersion: 'portfolio-value-advisor-v4', generatedAt: '2026-09-21T00:00:00Z', model: 'deepseek-v4-flash', mode: 'INITIAL_ANALYSIS', ...initialPortfolioConsultationOutput() });
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); resetPortfolioAiRateLimitForTests(); });

describe('v3 production / v4 research compatibility', () => {
  it('accepts both schemas with identical strict request checks', () => {
    const current = initialPortfolioConsultationRequest();
    const legacy = { ...current, schemaVersion: 3 };
    expect(parsePortfolioWireRequest(legacy)?.request).toEqual(current);
    expect(parsePortfolioWireRequest(current)?.version).toBe(4);
    expect(parsePortfolioWireRequest({ ...legacy, email: 'forbidden' })).toBeNull();
    expect(parsePortfolioWireRequest({ ...legacy, schemaVersion: 2 })).toBeNull();
  });
  it.each([3, 4] as const)('returns the requested schema %s through the provider route', async (version) => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-test-value');
    model.consult.mockResolvedValue({ model: 'deepseek-v4-flash', output: initialPortfolioConsultationOutput() });
    const result = await POST(new Request('https://provider.test/api/ai/portfolio-analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...initialPortfolioConsultationRequest(), schemaVersion: version }) }));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(await result.json()).toMatchObject({ schemaVersion: version, promptVersion: version === 3 ? 'portfolio-consultation-v3' : 'portfolio-value-advisor-v4' });
  });
  it('allows new production Sites to use old v3 provider during rollback', async () => {
    vi.stubEnv('NEXT_PUBLIC_PORTFOLIO_EXPERIENCE', 'production');
    const fetcher = vi.fn(async () => Response.json(portfolioWireResponse(success(), 3)));
    const request = initialPortfolioConsultationRequest();
    expect(await requestPortfolioConsultation(request, fetcher)).toEqual(success());
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).schemaVersion).toBe(3);
  });
  it('strips v4-only answer fields without dropping the shared evidence', () => {
    const current = { ...success(), answer: { text: '当前资料不足以评价企业长期竞争优势', evidenceRefs: ['portfolio.data'], frameworkLenses: ['EVIDENCE_GAP'] as const, suggestedQuestions: [] } };
    const legacy = portfolioWireResponse(current, 3);
    expect(legacy.answer).toEqual({ text: current.answer.text, evidenceRefs: ['portfolio.data'], suggestedQuestions: [] });
    expect(parsePortfolioConsultationApiResponse(success(), initialPortfolioConsultationRequest())).not.toBeNull();
  });
});
