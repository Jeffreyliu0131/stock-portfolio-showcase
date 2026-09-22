import type { Metadata } from "next";

import { PositionEntryForm } from "../../../components/position-entry-form";
import { requireChatGPTUser } from "../../chatgpt-auth";

export const metadata: Metadata = {
  title: "录入持仓",
};

export const dynamic = "force-dynamic";

type NewPositionPageProps = {
  searchParams: Promise<{
    instrument?: string | string[];
    mode?: string | string[];
  }>;
};

export default async function NewPositionPage({
  searchParams,
}: NewPositionPageProps) {
  await requireChatGPTUser("/positions/new");
  const params = await searchParams;
  const instrument =
    typeof params.instrument === "string"
      ? params.instrument
      : undefined;
  const mode =
    params.mode === "add" ? ("add" as const) : ("edit" as const);
  return instrument === undefined ? (
    <PositionEntryForm />
  ) : (
    <PositionEntryForm
      initialInstrumentKey={instrument}
      initialMode={mode}
    />
  );
}
