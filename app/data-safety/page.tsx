import type { Metadata } from "next";

import { DataSafetyCenter } from "../../components/data-safety-center";
import { requireChatGPTUser } from "../chatgpt-auth";

export const metadata: Metadata = {
  title: "数据安全与恢复",
};

export const dynamic = "force-dynamic";

export default async function DataSafetyPage() {
  const user = await requireChatGPTUser("/data-safety");
  return <DataSafetyCenter accountDisplayName={user.displayName} />;
}
