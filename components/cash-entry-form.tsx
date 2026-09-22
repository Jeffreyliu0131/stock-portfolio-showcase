"use client";

import Decimal from "decimal.js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  PositionRepositoryError,
  type CashSnapshot,
} from "../application/positions/index.ts";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "../application/portfolio-repository.ts";
import {
  IBKR_USD_INTEREST_POLICY,
  estimateIbkrUsdCashInterest,
  type IbkrPricingPlan,
} from "../domain/index.ts";
import {
  formatUsd,
  isPositiveDecimalInput,
} from "../ui/position-preview.ts";

type CashFormErrors = {
  balance?: string;
  netAssetValue?: string;
};

function formatPercent(value: string): string {
  return `${new Decimal(value).mul(100).toFixed(2)}%`;
}

function signedUsd(value: string): string {
  const amount = new Decimal(value);
  if (amount.isZero()) {
    return formatUsd("0");
  }
  return `${amount.isPositive() ? "+" : "−"}${formatUsd(
    amount.abs().toString(),
  )}`;
}

export function CashEntryForm() {
  const router = useRouter();
  const repositoryRef = useRef<PortfolioRepository | null>(null);
  const submitInFlight = useRef(false);
  const deleteInFlight = useRef(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [snapshot, setSnapshot] = useState<CashSnapshot | null>(null);
  const [balance, setBalance] = useState("");
  const [netAssetValue, setNetAssetValue] = useState("");
  const [pricingPlan, setPricingPlan] =
    useState<IbkrPricingPlan>("IBKR_PRO");
  const [errors, setErrors] = useState<CashFormErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const repository = () => {
    repositoryRef.current ??= createPortfolioRepository();
    return repositoryRef.current;
  };

  useEffect(() => {
    let active = true;
    const currentRepository = repository();
    const brokerReader = currentRepository as unknown as {
      getBrokerPortfolioBook?: () => Promise<unknown>;
    };
    void (
      typeof brokerReader.getBrokerPortfolioBook === "function"
        ? brokerReader.getBrokerPortfolioBook()
        : Promise.resolve(null)
    )
      .then((brokerBook) => {
        if (brokerBook !== null) {
          router.replace("/portfolio-setup");
          return null;
        }
        return currentRepository.getCashSnapshot();
      })
      .then((current) => {
        if (!active) {
          return;
        }
        setSnapshot(current);
        if (current !== null) {
          setBalance(current.account.balance);
          setNetAssetValue(
            current.account.navSource === "USER_ENTERED"
              ? current.account.netAssetValue
              : "",
          );
          setPricingPlan(current.account.pricingPlan);
        }
      })
      .catch(() => {
        if (active) {
          setNotice(
            "无法读取账号现金记录。现有股票持仓没有被修改，请返回首页重试。",
          );
        }
      })
      .finally(() => {
        if (active) {
          setIsHydrated(true);
        }
      });
    return () => {
      active = false;
    };
  }, [router]);

  const preview = useMemo(() => {
    const normalizedBalance = balance.trim();
    const normalizedNav = netAssetValue.trim();
    if (
      !isPositiveDecimalInput(normalizedBalance) ||
      (normalizedNav.length > 0 &&
        !isPositiveDecimalInput(normalizedNav))
    ) {
      return null;
    }
    try {
      return estimateIbkrUsdCashInterest({
        provider: "IBKR",
        currency: "USD",
        balance: normalizedBalance,
        netAssetValue:
          normalizedNav.length > 0 ? normalizedNav : normalizedBalance,
        navSource:
          normalizedNav.length > 0
            ? "USER_ENTERED"
            : "CASH_BALANCE_FALLBACK",
        pricingPlan,
      });
    } catch {
      return null;
    }
  }, [balance, netAssetValue, pricingPlan]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitInFlight.current || deleteInFlight.current) {
      return;
    }
    const normalizedBalance = balance.trim();
    const normalizedNav = netAssetValue.trim();
    const nextErrors: CashFormErrors = {};
    if (!isPositiveDecimalInput(normalizedBalance)) {
      nextErrors.balance = "请输入大于 0、最多 8 位小数的 USD 现金金额。";
    }
    if (
      normalizedNav.length > 0 &&
      !isPositiveDecimalInput(normalizedNav)
    ) {
      nextErrors.netAssetValue =
        "NAV 必须是大于 0、最多 8 位小数的 USD 金额。";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            nextErrors.balance ? "#cash-balance" : "#cash-nav",
          )
          ?.focus();
      });
      return;
    }

    submitInFlight.current = true;
    setIsSubmitting(true);
    setNotice(null);
    try {
      await repository().replaceCashAccount(
        {
          provider: "IBKR",
          currency: "USD",
          balance: normalizedBalance,
          netAssetValue:
            normalizedNav.length > 0 ? normalizedNav : normalizedBalance,
          navSource:
            normalizedNav.length > 0
              ? "USER_ENTERED"
              : "CASH_BALANCE_FALLBACK",
          pricingPlan,
        },
        { expectedRevision: snapshot?.revision ?? null },
      );
      if (navigator.storage?.persist) {
        void navigator.storage.persist().catch(() => undefined);
      }
      router.push("/");
    } catch (error) {
      setNotice(
        error instanceof PositionRepositoryError &&
          error.code === "CASH_SNAPSHOT_CONFLICT"
          ? "另一页面刚更新了现金记录。当前输入仍保留，请返回首页刷新后再修改。"
          : "现金记录保存失败，当前输入和已有股票持仓都没有被清空。",
      );
    } finally {
      submitInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const deleteCash = async () => {
    if (
      snapshot === null ||
      deleteInFlight.current ||
      submitInFlight.current
    ) {
      return;
    }
    deleteInFlight.current = true;
    setIsDeleting(true);
    setNotice(null);
    try {
      await repository().deleteCashSnapshot({
        expectedRevision: snapshot.revision,
      });
      router.push("/");
    } catch {
      setNotice(
        "现金记录删除失败，记录可能已在另一页面更新；股票持仓没有被修改。",
      );
    } finally {
      deleteInFlight.current = false;
      setIsDeleting(false);
    }
  };

  if (!isHydrated) {
    return (
      <main
        className="app-shell app-shell--centered precision-form"
        aria-busy="true"
        aria-label="正在读取现金记录"
      >
        <section className="state-card">
          <p className="eyebrow">账号现金</p>
          <h1>正在读取</h1>
          <p>现有股票持仓不会在载入时被改写。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell app-shell--form precision-form">
      <header className="form-header">
        <Link
          className="icon-link"
          href="/"
          aria-label="返回总资产"
          aria-disabled={isSubmitting || isDeleting}
        >
          返回
        </Link>
        <div>
          <p className="eyebrow">现金模块</p>
          <h1>{snapshot === null ? "录入 IBKR 现金" : "修改 IBKR 现金"}</h1>
        </div>
        <span className="form-header__spacer" aria-hidden="true" />
      </header>

      {notice ? (
        <p className="inline-notice" role="alert">
          {notice}
        </p>
      ) : null}

      <form
        className="entry-form"
        noValidate
        aria-busy={isSubmitting || isDeleting}
        onSubmit={submit}
      >
        <section className="form-section" aria-labelledby="cash-input-heading">
          <div className="form-section__heading">
            <span>1</span>
            <div>
              <h2 id="cash-input-heading">填写现金</h2>
              <p>金额只保存在当前手机的 IndexedDB，不发送给 IBKR 或 Vercel。</p>
            </div>
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="cash-balance">IBKR USD 现金余额</label>
              <input
                className="numeric"
                id="cash-balance"
                inputMode="decimal"
                autoComplete="off"
                value={balance}
                placeholder="例如 25000"
                disabled={isSubmitting || isDeleting}
                aria-invalid={Boolean(errors.balance)}
                aria-describedby={
                  errors.balance ? "cash-balance-error" : "cash-balance-help"
                }
                onChange={(event) => {
                  setBalance(event.target.value);
                  setErrors((current) => {
                    const next = { ...current };
                    delete next.balance;
                    return next;
                  });
                }}
              />
              <p
                className={errors.balance ? "field-error" : "field-help"}
                id={errors.balance ? "cash-balance-error" : "cash-balance-help"}
              >
                {errors.balance ?? "只支持正数 USD 金额，最多 8 位小数。"}
              </p>
            </div>

            <div className="field">
              <label htmlFor="cash-plan">IBKR 定价方案</label>
              <select
                id="cash-plan"
                value={pricingPlan}
                disabled={isSubmitting || isDeleting}
                onChange={(event) =>
                  setPricingPlan(event.target.value as IbkrPricingPlan)
                }
              >
                <option value="IBKR_PRO">IBKR Pro</option>
                <option value="IBKR_LITE">IBKR Lite</option>
              </select>
              <p className="field-help">
                当前官网公布的 USD 档位年利率分别为 Pro 3.13%、Lite 2.13%。
              </p>
            </div>

            <div className="field">
              <label htmlFor="cash-nav">IBKR 账户净资产 NAV（可选）</label>
              <input
                className="numeric"
                id="cash-nav"
                inputMode="decimal"
                autoComplete="off"
                value={netAssetValue}
                placeholder="例如 120000"
                disabled={isSubmitting || isDeleting}
                aria-invalid={Boolean(errors.netAssetValue)}
                aria-describedby={
                  errors.netAssetValue ? "cash-nav-error" : "cash-nav-help"
                }
                onChange={(event) => {
                  setNetAssetValue(event.target.value);
                  setErrors((current) => {
                    const next = { ...current };
                    delete next.netAssetValue;
                    return next;
                  });
                }}
              />
              <p
                className={
                  errors.netAssetValue ? "field-error" : "field-help"
                }
                id={errors.netAssetValue ? "cash-nav-error" : "cash-nav-help"}
              >
                {errors.netAssetValue ??
                  "IBKR 用账户 NAV 调整利率。留空时暂按现金金额作为 NAV 估算，不会拿其他来源的股票冒充 IBKR NAV。"}
              </p>
            </div>
          </div>
        </section>

        <section
          className="form-section form-section--reference"
          aria-labelledby="cash-rule-heading"
        >
          <div className="form-section__heading">
            <span>2</span>
            <div>
              <h2 id="cash-rule-heading">IBKR 官方规则</h2>
              <p>直接客户的正数已结算 USD 现金：首 USD 10,000 不计息；NAV 低于 USD 100,000 时，档位利率按 NAV 比例降低。</p>
            </div>
          </div>
          <p className="cash-rate-source">
            <a
              href={IBKR_USD_INTEREST_POLICY.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Interactive Brokers 官方现金利率
            </a>
            <span> · {IBKR_USD_INTEREST_POLICY.verifiedAt} 核验</span>
          </p>
        </section>

        <section className="preview-card" aria-labelledby="cash-preview-heading">
          <div className="preview-card__heading">
            <div>
              <p className="eyebrow">利息估算</p>
              <h2 id="cash-preview-heading">IBKR USD 现金</h2>
            </div>
            <span>{pricingPlan === "IBKR_PRO" ? "IBKR Pro" : "IBKR Lite"}</span>
          </div>
          {preview === null ? (
            <p className="preview-card__empty">填写有效现金金额后生成估算。</p>
          ) : (
            <>
              <dl className="preview-metrics cash-preview-metrics">
                <div>
                  <dt>现金余额</dt>
                  <dd className="numeric">{formatUsd(preview.cashBalance)}</dd>
                </div>
                <div>
                  <dt>计息余额</dt>
                  <dd className="numeric">{formatUsd(preview.interestBearingBalance)}</dd>
                </div>
                <div>
                  <dt>NAV 调整后利率</dt>
                  <dd className="numeric">{formatPercent(preview.navAdjustedAnnualRate)}</dd>
                </div>
                <div>
                  <dt>整笔混合年利率</dt>
                  <dd className="numeric">{formatPercent(preview.blendedAnnualRate)}</dd>
                </div>
                <div>
                  <dt>估算年利息</dt>
                  <dd className="numeric">{signedUsd(preview.estimatedAnnualInterest)}</dd>
                </div>
                <div>
                  <dt>估算月均利息</dt>
                  <dd className="numeric">{signedUsd(preview.estimatedMonthlyInterest)}</dd>
                </div>
              </dl>
              <p className="cash-preview-note">
                {netAssetValue.trim().length === 0
                  ? `未填写 NAV，当前暂按现金余额 ${formatUsd(preview.netAssetValue)} 估算。`
                  : `按你填写的 IBKR NAV ${formatUsd(preview.netAssetValue)} 估算。`}
                实际计息余额、日数、账户结构与最终入账以 IBKR 为准。
              </p>
            </>
          )}
        </section>

        {snapshot !== null ? (
          <section className="cash-delete-zone" aria-label="删除现金记录">
            {confirmingDelete ? (
              <>
                <p>
                  确认删除这条 IBKR 现金记录？股票持仓不会受影响；删除后无法从 App 内恢复。
                </p>
                <div>
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={isSubmitting || isDeleting}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    取消
                  </button>
                  <button
                    className="button button--danger-outline"
                    type="button"
                    disabled={isSubmitting || isDeleting}
                    aria-busy={isDeleting}
                    onClick={() => void deleteCash()}
                  >
                    {isDeleting ? "删除中…" : "确认删除"}
                  </button>
                </div>
              </>
            ) : (
              <button
                className="button button--danger-outline button--full"
                type="button"
                disabled={isSubmitting || isDeleting}
                onClick={() => setConfirmingDelete(true)}
              >
                删除现金记录
              </button>
            )}
          </section>
        ) : null}

        <div className="form-actions">
          <Link
            className="button button--quiet button--full"
            href="/"
            aria-disabled={isSubmitting || isDeleting}
          >
            返回首页
          </Link>
          <button
            className="button button--primary button--full"
            type="submit"
            disabled={isSubmitting || isDeleting}
            aria-busy={isSubmitting}
          >
            {isSubmitting
              ? "保存中…"
              : snapshot === null
                ? "保存现金"
                : "保存修改"}
          </button>
        </div>
      </form>
    </main>
  );
}
