import { PortfolioController } from "../components/portfolio-controller";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireChatGPTUser("/");
  return <PortfolioController />;
}
