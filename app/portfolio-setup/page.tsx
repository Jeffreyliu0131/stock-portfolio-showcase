import { BrokerPortfolioSetup } from "../../components/broker-portfolio-setup";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function PortfolioSetupPage() {
  await requireChatGPTUser("/portfolio-setup");
  return <BrokerPortfolioSetup />;
}
