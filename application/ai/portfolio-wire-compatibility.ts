import {
  PORTFOLIO_CONSULTATION_SCHEMA_VERSION,
  PORTFOLIO_CONSULTATION_PROMPT_VERSION,
  parsePortfolioConsultationRequest,
  type PortfolioConsultationSuccess,
} from './portfolio-consultation-api.ts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// v3 and v4 have identical request fields except schemaVersion. Always apply
// the full strict parser after normalization: no unknown field is discarded.
export function parsePortfolioWireRequest(value: unknown) {
  const legacy = record(value) && value.schemaVersion === 3;
  const request = parsePortfolioConsultationRequest(legacy ? { ...value, schemaVersion: 4 } : value);
  return request === null ? null : { request, version: legacy ? 3 as const : 4 as const };
}

export function portfolioWireResponse(value: PortfolioConsultationSuccess, version: 3 | 4) {
  if (version === 4) return value;
  const answer = value.answer === null ? null : {
    text: value.answer.text, evidenceRefs: value.answer.evidenceRefs,
    suggestedQuestions: value.answer.suggestedQuestions,
  };
  return { ...value, schemaVersion: 3, promptVersion: 'portfolio-consultation-v3', answer };
}

// Production clients keep v3 on the wire so provider and Sites can roll back
// independently. This adapter adds no numerical or investment claims.
export function normalizeLegacyPortfolioResponse(value: unknown): unknown {
  if (!record(value) || value.kind === 'ERROR') return value;
  if (value.schemaVersion !== 3 || value.promptVersion !== 'portfolio-consultation-v3') return null;
  if (value.answer !== null && (!record(value.answer) ||
    Object.keys(value.answer).sort().join(',') !== 'evidenceRefs,suggestedQuestions,text')) return null;
  return { ...value, schemaVersion: PORTFOLIO_CONSULTATION_SCHEMA_VERSION,
    promptVersion: PORTFOLIO_CONSULTATION_PROMPT_VERSION,
    answer: value.answer === null ? null : { ...(value.answer as Record<string, unknown>), frameworkLenses: ['EVIDENCE_GAP'] },
  };
}
