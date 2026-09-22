// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IndexedDbPositionRepository } from "../application/positions/index.ts";
import type { PositionBatch } from "../application/positions/types.ts";
import { instrumentKeyId } from "../domain/index.ts";
import { AAPL } from "../tests/helpers.ts";
import { PositionEntryForm } from "./position-entry-form.tsx";

const router = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

function batch(
  quantity: string,
  averageCost: string,
  id: string,
): PositionBatch {
  return {
    instrument: AAPL,
    displayName: "Apple Inc.",
    inputs: [
      {
        id,
        instrument: AAPL,
        quantity,
        costInput: {
          mode: "AVERAGE_COST",
          value: averageCost,
        },
      },
    ],
  };
}

function instrumentResponse() {
  return new Response(
    JSON.stringify({
      kind: "INSTRUMENT",
      instrument: AAPL,
      displayName: "Apple Inc.",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function unsupportedInstrumentResponse() {
  return new Response(
    JSON.stringify({
      kind: "ERROR",
      code: "INSTRUMENT_NOT_SUPPORTED",
      message: "Alpaca 未找到可交易的美股或 ETF 标的。",
    }),
    {
      status: 422,
      headers: { "Content-Type": "application/json" },
    },
  );
}

afterEach(() => {
  cleanup();
  router.push.mockReset();
  vi.unstubAllGlobals();
});

describe("PositionEntryForm", () => {
  it("adds a repeated stock entry to the saved batch and previews the merged totals", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => instrumentResponse()),
    );

    const seedRepository = new IndexedDbPositionRepository({
      indexedDB,
    });
    await seedRepository.replaceBatch(
      batch("10", "100", "position-input-1"),
    );
    await seedRepository.close();

    render(<PositionEntryForm />);
    await screen.findByRole("heading", { name: "录入持仓" });
    fireEvent.change(screen.getByLabelText("股票代码"), {
      target: { value: "AAPL" },
    });
    fireEvent.change(screen.getByLabelText(/持有数量/), {
      target: { value: "5" },
    });
    fireEvent.change(
      screen.getByLabelText(/每股平均成本（USD）/),
      {
        target: { value: "120" },
      },
    );

    await screen.findByText(/当前持仓共 1 组/);
    expect(screen.getByText("15 股")).toBeInTheDocument();
    expect(screen.getByText("$1,600.00")).toBeInTheDocument();
    expect(screen.getByText("$106.67")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "叠加并保存" }),
    );
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/");
    });

    const repository = new IndexedDbPositionRepository({
      indexedDB,
    });
    const saved = await repository.getSnapshot(AAPL);
    expect(saved?.batch.inputs).toHaveLength(2);
    expect(
      new Set(saved?.batch.inputs.map(({ id }) => id)).size,
    ).toBe(2);
    expect(
      saved?.batch.inputs.map(({ quantity }) => quantity),
    ).toEqual(["10", "5"]);
    await repository.close();
  });

  it("prefills modification with the current merged quantity and average cost", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => instrumentResponse()),
    );

    const seedRepository = new IndexedDbPositionRepository({
      indexedDB,
    });
    await seedRepository.replaceBatch(
      batch("10", "100", "first"),
    );
    await seedRepository.addInputsToBatch(
      batch("5", "120", "second"),
    );
    await seedRepository.close();

    render(
      <PositionEntryForm
        initialInstrumentKey={instrumentKeyId(AAPL)}
        initialMode="edit"
      />,
    );

    await screen.findByRole("heading", { name: "修改持仓" });
    expect(
      screen.getAllByLabelText(/当前持有数量/),
    ).toHaveLength(1);
    expect(screen.getByLabelText(/当前持有数量/)).toHaveValue(
      "15",
    );
    expect(
      screen.getByLabelText(/当前平均成本（USD）/),
    ).toHaveValue("106.66666667");
    expect(
      screen.queryByRole("button", {
        name: "添加一组数量与成本",
      }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/当前持有数量/), {
      target: { value: "20" },
    });
    fireEvent.change(
      screen.getByLabelText(/当前平均成本（USD）/),
      { target: { value: "110" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "保存修改" }),
    );
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/");
    });

    const repository = new IndexedDbPositionRepository({
      indexedDB,
    });
    await expect(repository.getSnapshot(AAPL)).resolves.toMatchObject(
      {
        batch: {
          inputs: [
            {
              quantity: "20",
              costInput: {
                mode: "AVERAGE_COST",
                value: "110",
              },
            },
          ],
        },
      },
    );
    await repository.close();
  });

  it("adds to a selected stock using quantity and purchase average", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => instrumentResponse()),
    );

    const seedRepository = new IndexedDbPositionRepository({
      indexedDB,
    });
    await seedRepository.replaceBatch(
      batch("10", "100", "existing"),
    );
    await seedRepository.close();

    render(
      <PositionEntryForm
        initialInstrumentKey={instrumentKeyId(AAPL)}
        initialMode="add"
      />,
    );

    await screen.findByRole("heading", { name: "加仓" });
    expect(screen.getByLabelText("股票代码")).toHaveAttribute(
      "readonly",
    );
    fireEvent.change(screen.getByLabelText(/本次加仓数量/), {
      target: { value: "5" },
    });
    fireEvent.change(
      screen.getByLabelText(/本次买入均价（USD）/),
      {
        target: { value: "120" },
      },
    );
    expect(screen.getByText("15 股")).toBeInTheDocument();
    expect(screen.getByText("$106.67")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "确认加仓" }),
    );
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/");
    });

    const repository = new IndexedDbPositionRepository({
      indexedDB,
    });
    const saved = await repository.getSnapshot(AAPL);
    expect(saved?.batch.inputs).toHaveLength(2);
    expect(
      saved?.batch.inputs.map(({ quantity }) => quantity),
    ).toEqual(["10", "5"]);
    await repository.close();
  });

  it("does not recreate a selected holding that no longer exists", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => instrumentResponse()),
    );

    render(
      <PositionEntryForm
        initialInstrumentKey={instrumentKeyId(AAPL)}
        initialMode="add"
      />,
    );

    await screen.findByRole("heading", { name: "加仓" });
    expect(
      screen.getByText(
        "没有找到该标的的当前持仓，请返回首页后重试。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "持仓已不存在" }),
    ).toBeDisabled();

    const repository = new IndexedDbPositionRepository({
      indexedDB,
    });
    await expect(repository.getSnapshot(AAPL)).resolves.toBeNull();
    await repository.close();
  });

  it("does not silently overwrite a version changed in another tab", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => instrumentResponse()),
    );

    const seedRepository = new IndexedDbPositionRepository({
      indexedDB,
    });
    const original = await seedRepository.replaceBatch(
      batch("10", "100", "original"),
    );
    await seedRepository.saveEntryDraft({
      symbol: "MSFT",
      displayName: "",
      listingMarket: "NASDAQ",
      currency: "USD",
      costMode: "average",
      rows: [
        {
          id: "position-input-1",
          quantity: "2",
          costValue: "300",
        },
      ],
    });
    await seedRepository.close();

    render(
      <PositionEntryForm
        initialInstrumentKey={instrumentKeyId(AAPL)}
      />,
    );
    await screen.findByText("已载入 AAPL 当前合并数量与均价。");
    expect(screen.getByLabelText(/持有数量/)).toHaveValue("10");
    expect(screen.getByLabelText(/当前平均成本（USD）/)).toHaveValue(
      "100",
    );

    const concurrentRepository = new IndexedDbPositionRepository({
      indexedDB,
    });
    await concurrentRepository.replaceBatch(
      batch("99", "101", "concurrent"),
      { expectedRevision: original.revision },
    );

    fireEvent.change(screen.getByLabelText(/持有数量/), {
      target: { value: "12" },
    });
    fireEvent.change(
      screen.getByLabelText(/当前平均成本（USD）/),
      {
        target: { value: "102" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "保存修改" }),
    );

    await screen.findByText(
      "另一页面刚更新了该持仓。当前输入仍保留，请核对后重试。",
    );
    expect(
      await screen.findByRole("button", {
        name: "先载入当前持仓",
      }),
    ).toBeDisabled();
    expect(router.push).not.toHaveBeenCalled();
    await expect(
      concurrentRepository.getSnapshot(AAPL),
    ).resolves.toMatchObject({
      revision: 2,
      batch: {
        inputs: [{ id: "concurrent", quantity: "99" }],
      },
    });
    await expect(
      concurrentRepository.getEntryDraft(),
    ).resolves.toMatchObject({
      symbol: "MSFT",
      rows: [{ quantity: "2", costValue: "300" }],
    });
    await concurrentRepository.close();

    await waitFor(() => {
      expect(
        screen.getByLabelText(/持有数量/),
      ).toHaveValue("12");
    });
  });

  it("allocates a unique row id after restoring a draft with gaps", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => instrumentResponse()),
    );
    const repository = new IndexedDbPositionRepository({
      indexedDB,
    });
    await repository.saveEntryDraft({
      symbol: "AAPL",
      displayName: "",
      listingMarket: "NASDAQ",
      currency: "USD",
      costMode: "average",
      rows: [
        {
          id: "position-input-1",
          quantity: "1",
          costValue: "100",
          costMode: "total",
        },
        {
          id: "position-input-3",
          quantity: "2",
          costValue: "110",
          costMode: "average",
        },
      ],
    });
    await repository.close();

    render(<PositionEntryForm />);
    await screen.findByText("已恢复上次未保存的输入。");
    fireEvent.click(
      screen.getByRole("button", {
        name: "添加一组数量与成本",
      }),
    );

    await waitFor(() => {
      expect(
        document.querySelector("#position-input-2-quantity"),
      ).toHaveFocus();
    });
    expect(
      document.querySelectorAll("#position-input-1-quantity"),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll("#position-input-2-quantity"),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll("#position-input-3-quantity"),
    ).toHaveLength(1);
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="position-input-1-cost-mode"][value="total"]',
      ),
    ).toBeChecked();
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="position-input-3-cost-mode"][value="average"]',
      ),
    ).toBeChecked();
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="position-input-2-cost-mode"][value="average"]',
      ),
    ).toBeChecked();

    fireEvent.click(
      screen.getByRole("button", { name: "删除输入 3" }),
    );
    await waitFor(() => {
      expect(
        document.querySelector("#position-input-3-quantity"),
      ).toHaveFocus();
    });
  });

  it("automatically resolves the symbol, market, and fixed USD currency", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    const fetchMock = vi.fn(
      async (..._args: Parameters<typeof fetch>) =>
        instrumentResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PositionEntryForm />);
    await screen.findByRole("heading", { name: "录入持仓" });

    expect(
      screen.queryByRole("button", {
        name: "用 Alpaca 验证标的",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("币种")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("股票代码"), {
      target: { value: "aapl" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(
      JSON.parse(
        String(
          (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)
            ?.body,
        ),
      ),
    ).toEqual({ symbol: "AAPL" });
    await waitFor(() => {
      expect(
        screen.getByLabelText("股票名称（Alpaca）"),
      ).toHaveValue("Apple Inc.");
      expect(screen.getByLabelText("上市市场")).toHaveValue(
        "纳斯达克（NASDAQ）",
      );
    });
    expect(screen.getByLabelText("上市市场")).toHaveAttribute(
      "readonly",
    );
    expect(
      screen.getByText(
        /已由 Alpaca 确认：Apple Inc. · NASDAQ · USD/,
      ),
    ).toBeInTheDocument();
  });

  it("ignores an obsolete verification response after the symbol changes", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    let resolveFetch:
      | ((response: Response) => void)
      | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PositionEntryForm />);
    await screen.findByRole("heading", { name: "录入持仓" });
    const symbol = screen.getByLabelText("股票代码");
    fireEvent.change(symbol, { target: { value: "AAPL" } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(symbol, { target: { value: "MSFT" } });
    resolveFetch?.(instrumentResponse());

    await waitFor(() => {
      expect(symbol).toHaveValue("MSFT");
      expect(
        screen.getByLabelText("股票名称（Alpaca）"),
      ).toHaveValue("");
    });
  });

  it("locks editable controls while a save request is in flight", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    let resolveFetch:
      | ((response: Response) => void)
      | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    render(<PositionEntryForm />);
    await screen.findByRole("heading", { name: "录入持仓" });
    fireEvent.change(screen.getByLabelText("股票代码"), {
      target: { value: "AAPL" },
    });
    fireEvent.change(screen.getByLabelText(/持有数量/), {
      target: { value: "1" },
    });
    fireEvent.change(
      screen.getByLabelText(/每股平均成本（USD）/),
      {
        target: { value: "100" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "保存持仓" }),
    );

    expect(screen.getByLabelText("股票代码")).toBeDisabled();
    expect(screen.getByLabelText(/持有数量/)).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "添加一组数量与成本",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "返回首页" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("link", { name: "返回总仓位" }),
    ).toHaveAttribute("aria-disabled", "true");

    resolveFetch?.(unsupportedInstrumentResponse());
    await waitFor(() => {
      expect(screen.getByLabelText("股票代码")).toHaveFocus();
      expect(screen.getByLabelText("股票代码")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    expect(
      screen.getAllByText(
        "Alpaca 未找到可交易的美股或 ETF 标的。",
      ),
    ).toHaveLength(2);
    expect(router.push).not.toHaveBeenCalled();
  });
});
