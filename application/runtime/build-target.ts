declare const process: { readonly env: Readonly<Record<string, string | undefined>> };
// Only non-secret compile-time values. Production builds validate them before bundling.
export function portfolioTarget(): string {
  return process.env.NEXT_PUBLIC_PORTFOLIO_TARGET ?? 'demo';
}
export function productionExperience(): boolean {
  return process.env.NEXT_PUBLIC_PORTFOLIO_EXPERIENCE === 'production';
}
