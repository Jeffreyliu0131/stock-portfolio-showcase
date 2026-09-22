import { BrokerTradeForm } from "../../../components/broker-trade-form";
import { requireChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

type TradePageProps = {
  searchParams: Promise<{
    side?: string | string[];
    instrument?: string | string[];
  }>;
};

export default async function NewTradePage({ searchParams }: TradePageProps) {
  await requireChatGPTUser("/trades/new");
  const params = await searchParams;
  const side = params.side === "SELL" ? "SELL" : "BUY";
  const instrument =
    typeof params.instrument === "string" ? params.instrument : undefined;
  return (
    <BrokerTradeForm
      initialSide={side}
      {...(instrument === undefined ? {} : { initialInstrumentKey: instrument })}
    />
  );
}
