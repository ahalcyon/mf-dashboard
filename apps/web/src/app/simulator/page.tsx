import { getHoldingsWithLatestValues } from "@mf-dashboard/db";
import type { Metadata } from "next";
import { CompoundSimulator } from "../../components/charts/compound-simulator/compound-simulator";
import { PageLayout } from "../../components/layout/page-layout";
import { sumInvestmentHoldings } from "../../lib/investment-total";

export const metadata: Metadata = {
  title: "シミュレーター",
};

export async function SimulatorContent({ groupId }: { groupId?: string }) {
  const holdings = await getHoldingsWithLatestValues(groupId);
  const totalInvestment = sumInvestmentHoldings(holdings);

  const isDemo = process.env.DEMO_MODE === "true";

  return (
    <PageLayout title="シミュレーター">
      <CompoundSimulator
        defaultInitialAmount={totalInvestment}
        portfolioContext={
          isDemo
            ? undefined
            : {
                initialAmountSource: "あなたの投資総額",
              }
        }
      />
    </PageLayout>
  );
}

export default function SimulatorPage() {
  return <SimulatorContent />;
}
