import { describe, expect, it, vi } from "vitest";

import {
  consultPortfolioWithDeepSeek,
} from "../application/ai/server/deepseek-portfolio-consultant.ts";
import type {
  PortfolioConsultationMode,
  PortfolioConsultationModelOutput,
} from "../application/ai/portfolio-consultation-api.ts";
import {
  chatPortfolioConsultationOutput,
  chatPortfolioConsultationRequest,
  followUpPortfolioConsultationOutput,
  followUpPortfolioConsultationRequest,
  initialPortfolioConsultationOutput,
  initialPortfolioConsultationRequest,
} from "./portfolio-consultation-fixtures.ts";

const TOOL_NAME = "return_portfolio_consultation";

function internalArguments(
  output: PortfolioConsultationModelOutput,
  mode: PortfolioConsultationMode,
): unknown {
  if (mode === "INITIAL_ANALYSIS") {
    return {
      classifications: Object.fromEntries(
        output.classifications.map((classification) => [
          classification.positionId,
          {
            instrumentType: classification.instrumentType,
            sector: classification.sector,
            themes: classification.themes,
            confidence: classification.confidence,
            rationale: classification.rationale,
          },
        ]),
      ),
      headline: output.brief?.headline,
      summary: output.brief?.summary,
      dimensions: Object.fromEntries(
        (output.brief?.dimensions ?? []).map((dimension) => [
          dimension.kind,
          {
            title: dimension.title,
            text: dimension.text,
            evidenceRefs: dimension.evidenceRefs,
          },
        ]),
      ),
    };
  }
  if (mode === "CHAT") {
    return {
      text: output.answer?.text,
      evidenceRefs: output.answer?.evidenceRefs,
      frameworkLenses: output.answer?.frameworkLenses,
    };
  }
  return {
    text: output.answer?.text,
    evidenceRefs: output.answer?.evidenceRefs,
    frameworkLenses: output.answer?.frameworkLenses,
    suggestedQuestions: output.answer?.suggestedQuestions,
  };
}

function upstreamArguments(argumentsValue: unknown, finishReason = "tool_calls") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: finishReason,
          message: {
            tool_calls: [
              {
                type: "function",
                function: {
                  name: TOOL_NAME,
                  arguments:
                    typeof argumentsValue === "string"
                      ? argumentsValue
                      : JSON.stringify(argumentsValue),
                },
              },
            ],
          },
        },
      ],
    }),
    { status: 200 },
  );
}

function upstream(
  output: PortfolioConsultationModelOutput,
  mode: PortfolioConsultationMode,
  finishReason = "tool_calls",
) {
  return upstreamArguments(internalArguments(output, mode), finishReason);
}

describe("consultPortfolioWithDeepSeek", () => {
  it("sends the full snapshot through a forced strict function and validates the initial brief", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        "https://api.deepseek.com/beta/chat/completions",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer private-test-key",
      );
      expect(init?.redirect).toBe("error");
      const body = JSON.parse(String(init?.body)) as {
        readonly model: string;
        readonly messages: readonly {
          readonly role: string;
          readonly content: string;
        }[];
        readonly thinking: unknown;
        readonly tools: readonly {
          readonly function: {
            readonly name: string;
            readonly strict: boolean;
            readonly parameters: {
              readonly properties: {
                readonly classifications: {
                  readonly properties: Readonly<
                    Record<
                      string,
                      {
                        readonly properties?: Readonly<Record<string, unknown>>;
                        readonly $ref?: string;
                      }
                    >
                  >;
                  readonly required: readonly string[];
                };
                readonly dimensions: {
                  readonly properties: Readonly<Record<string, unknown>>;
                };
              };
            };
          };
        }[];
        readonly tool_choice: unknown;
        readonly max_tokens: number;
      };
      expect(body).toMatchObject({
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        tool_choice: { type: "function", function: { name: TOOL_NAME } },
        max_tokens: 7_000,
      });
      expect(body).not.toHaveProperty("response_format");
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0]?.function).toMatchObject({
        name: TOOL_NAME,
        strict: true,
      });
      expect(
        Object.keys(
          body.tools[0]!.function.parameters.properties.classifications
            .properties,
        ),
      ).toEqual(["p0", "p1"]);
      expect(
        body.tools[0]!.function.parameters.properties.classifications.required,
      ).toEqual(["p0", "p1"]);
      expect(
        body.tools[0]!.function.parameters.properties.classifications.properties
          .p0,
      ).not.toHaveProperty("$ref");
      expect(
        Object.keys(
          body.tools[0]!.function.parameters.properties.classifications
            .properties.p0?.properties ?? {},
        ),
      ).toEqual([
        "instrumentType",
        "sector",
        "themes",
        "confidence",
        "rationale",
      ]);
      expect(
        Object.keys(
          body.tools[0]!.function.parameters.properties.dimensions.properties,
        ),
      ).toEqual([
        "ASSET_ALLOCATION",
        "CONCENTRATION",
        "SECTOR_THEME",
        "VEHICLE_OVERLAP",
        "PERFORMANCE_CONTRIBUTION",
        "DATA_LIMITS",
      ]);
      expect(body.messages[1]?.content).toContain('"name":"Apple Inc."');
      expect(body.messages[1]?.content).toContain('"quantity":"10"');
      expect(body.messages[1]?.content).toContain(
        '"netAssetValueUsd":"50000"',
      );
      expect(body.messages[0]?.content).toContain(
        "集中度只使用“头部持仓”",
      );
      expect(body.messages[0]?.content).toContain(
        "不得自称本人",
      );
      expect(body.messages[0]?.content).toContain(
        "所有者收益",
      );
      expect(body.messages.at(-1)?.content).toContain("INITIAL_ANALYSIS");
      expect(body).not.toHaveProperty("user");
      return upstream(
        initialPortfolioConsultationOutput(),
        "INITIAL_ANALYSIS",
      );
    });

    await expect(
      consultPortfolioWithDeepSeek(
        initialPortfolioConsultationRequest(),
        { apiKey: "private-test-key" },
        fetchMock,
      ),
    ).resolves.toEqual({
      model: "deepseek-v4-flash",
      output: initialPortfolioConsultationOutput(),
    });
  });

  it("uses real multi-turn messages and locks prior classifications on follow-up", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        readonly messages: readonly {
          readonly role: string;
          readonly content: string;
        }[];
      };
      expect(body.messages.map((message) => message.role)).toEqual([
        "system",
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
      ]);
      expect(body.messages[3]?.content).toContain(
        "PRIOR_CLASSIFICATIONS_JSON",
      );
      expect(body.messages[5]?.content).toBe(
        "科技相关暴露主要来自哪里？",
      );
      expect(body.messages[6]?.content).toContain("本机证据");
      expect(body.messages[7]?.content).toContain(
        "现金对当前组合起到什么作用？",
      );
      return upstream(followUpPortfolioConsultationOutput(), "FOLLOW_UP");
    });

    await expect(
      consultPortfolioWithDeepSeek(
        followUpPortfolioConsultationRequest(),
        { apiKey: "private-test-key" },
        fetchMock,
      ),
    ).resolves.toMatchObject({
      output: {
        brief: null,
        answer: followUpPortfolioConsultationOutput().answer,
      },
    });
  });

  it("repairs one rejected candidate inside the same bounded provider call", async () => {
    const valid = followUpPortfolioConsultationOutput();
    const invalid = {
      ...valid,
      answer: {
        ...valid.answer!,
        text: "前两只持仓共同影响当前结构。",
      },
    };
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      callCount += 1;
      const body = JSON.parse(String(init?.body)) as {
        readonly temperature: number;
        readonly messages: readonly {
          readonly role: string;
          readonly content: string;
        }[];
      };
      if (callCount === 1) {
        expect(body.temperature).toBe(0);
        return upstream(invalid, "FOLLOW_UP");
      }
      expect(body.temperature).toBe(0);
      expect(body.messages.at(-1)).toMatchObject({ role: "user" });
      expect(body.messages.at(-1)?.content).toContain(
        "上一个函数参数未通过本机完整 contract",
      );
      return upstream(valid, "FOLLOW_UP");
    });

    await expect(
      consultPortfolioWithDeepSeek(
        followUpPortfolioConsultationRequest(),
        { apiKey: "private-test-key" },
        fetchMock,
      ),
    ).resolves.toMatchObject({ output: valid });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the compact CHAT contract without classifications or suggestions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        readonly temperature: number;
        readonly max_tokens: number;
        readonly messages: readonly {
          readonly role: string;
          readonly content: string;
        }[];
        readonly tools: readonly {
          readonly function: {
            readonly parameters: {
              readonly properties: {
                readonly frameworkLenses: {
                  readonly minItems: number;
                  readonly maxItems: number;
                  readonly items: { readonly enum: readonly string[] };
                };
              };
            };
          };
        }[];
      };
      expect(body.temperature).toBe(0);
      expect(body.max_tokens).toBe(1_800);
      expect(body.messages.map((message) => message.role)).toEqual([
        "system",
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
      ]);
      expect(body.messages[3]?.content).toBe("当前组合最需要关注什么？");
      expect(body.messages.at(-1)?.content).toContain("CHAT 模式");
      expect(body.messages.at(-1)?.content).toContain(
        "现金在这个组合里起到什么作用？",
      );
      expect(body.messages[0]?.content).toContain(
        "CHAT 只直接回答当前问题",
      );
      expect(body.messages[0]?.content).toContain(
        "一手基本面证据",
      );
      expect(
        body.tools[0]?.function.parameters.properties.frameworkLenses,
      ).toMatchObject({ minItems: 1, maxItems: 3 });
      expect(
        body.tools[0]?.function.parameters.properties.frameworkLenses.items
          .enum,
      ).toContain("EVIDENCE_GAP");
      return upstream(chatPortfolioConsultationOutput(), "CHAT");
    });

    await expect(
      consultPortfolioWithDeepSeek(
        chatPortfolioConsultationRequest(),
        { apiKey: "private-test-key" },
        fetchMock,
      ),
    ).resolves.toEqual({
      model: "deepseek-v4-flash",
      output: chatPortfolioConsultationOutput(),
    });
  });

  it("caps fully valid strict evidence only after validating every reference", async () => {
    const valid = chatPortfolioConsultationOutput();
    const evidenceRefs = [
      "portfolio.structure",
      "portfolio.concentration",
      "portfolio.performance",
      "portfolio.daily",
      "portfolio.cash",
      "portfolio.data",
    ];
    const fetchMock = vi.fn<typeof fetch>(async () =>
      upstream(
        {
          ...valid,
          answer: { ...valid.answer!, evidenceRefs },
        },
        "CHAT",
      ),
    );

    await expect(
      consultPortfolioWithDeepSeek(
        chatPortfolioConsultationRequest(),
        { apiKey: "private-test-key" },
        fetchMock,
      ),
    ).resolves.toMatchObject({
      output: {
        answer: { evidenceRefs: evidenceRefs.slice(0, 5) },
      },
    });

    const invalidFetch = vi.fn<typeof fetch>(async () =>
      upstream(
        {
          ...valid,
          answer: {
            ...valid.answer!,
            evidenceRefs: [...evidenceRefs.slice(0, 5), "position.p99"],
          },
        },
        "CHAT",
      ),
    );
    await expect(
      consultPortfolioWithDeepSeek(
        chatPortfolioConsultationRequest(),
        { apiKey: "private-test-key" },
        invalidFetch,
      ),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT" });
  });

  it("rejects empty, truncated, unsafe, and unknown-evidence output", async () => {
    const valid = followUpPortfolioConsultationOutput();
    const responses = [
      upstreamArguments(""),
      upstream(valid, "FOLLOW_UP", "length"),
      upstream({
        ...valid,
        answer: { ...valid.answer!, text: "建议卖出头部持仓。" },
      }, "FOLLOW_UP"),
      upstream({
        ...valid,
        answer: { ...valid.answer!, evidenceRefs: ["position.p99"] },
      }, "FOLLOW_UP"),
    ];

    for (const response of responses) {
      const fetchMock = vi.fn<typeof fetch>(async () => response.clone());
      await expect(
        consultPortfolioWithDeepSeek(
          followUpPortfolioConsultationRequest(),
          { apiKey: "private-test-key" },
          fetchMock,
        ),
      ).rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it("maps provider throttling without exposing its body", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response("provider detail", { status: 429 }),
    );
    await expect(
      consultPortfolioWithDeepSeek(
        initialPortfolioConsultationRequest(),
        { apiKey: "private-test-key" },
        fetchMock,
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "AI 组合咨询请求较多，请稍后重试。",
    });
  });

  it("aborts a stalled provider request", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    await expect(
      consultPortfolioWithDeepSeek(
        initialPortfolioConsultationRequest(),
        { apiKey: "private-test-key", timeoutMs: 5 },
        fetchMock,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: "AI 组合咨询暂时无法连接。",
    });
  });
});


describe("production v3 provider compatibility", () => {
  it.each(["INITIAL_ANALYSIS", "CHAT", "FOLLOW_UP"] as const)("preserves production %s prompt and strict function schema", async (mode) => {
    const request = mode === "CHAT" ? chatPortfolioConsultationRequest() : mode === "FOLLOW_UP" ? followUpPortfolioConsultationRequest() : initialPortfolioConsultationRequest();
    const output = mode === "CHAT" ? chatPortfolioConsultationOutput() : mode === "FOLLOW_UP" ? followUpPortfolioConsultationOutput() : initialPortfolioConsultationOutput();
    const args = internalArguments(output, mode) as Record<string, unknown>;
    delete args.frameworkLenses;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(upstreamArguments(args));
    const result = await consultPortfolioWithDeepSeek(request, { apiKey: "synthetic-test-value", legacyV3: true }, fetchMock);
    expect(result.output.brief).toEqual(output.brief);
    expect(result.output.answer?.text).toEqual(output.answer?.text);
    const sent = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(sent.messages[0].content).toContain("谨慎、可审计的个人组合决策支持分析员");
    expect(sent.tools[0].function.parameters.properties).not.toHaveProperty("frameworkLenses");
    expect(sent.tools[0].function.parameters.additionalProperties).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
