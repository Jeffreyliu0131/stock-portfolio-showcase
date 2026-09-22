import type { Metadata } from "next";

import { CashEntryForm } from "../../components/cash-entry-form";
import { requireChatGPTUser } from "../chatgpt-auth";

export const metadata: Metadata = {
  title: "IBKR 现金",
};

export const dynamic = "force-dynamic";

export default async function CashPage() {
  await requireChatGPTUser("/cash");
  return <CashEntryForm />;
}
