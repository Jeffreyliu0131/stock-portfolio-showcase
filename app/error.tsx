"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="app-shell app-shell--centered">
      <section className="state-card" aria-labelledby="page-error-title">
        <p className="eyebrow">载入失败</p>
        <h1 id="page-error-title">页面暂时无法打开</h1>
        <p>已有数据不会因此被清空。请重试，或稍后重新打开页面。</p>
        <button className="button button--primary button--full" type="button" onClick={reset}>
          重新载入
        </button>
      </section>
    </main>
  );
}
