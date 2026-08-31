import { getHoldingsWithLatestValues } from "@mf-dashboard/db";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulatorContent } from "./page";

vi.mock("@mf-dashboard/db", () => ({
  getHoldingsWithLatestValues: vi.fn<typeof getHoldingsWithLatestValues>(),
}));

vi.mock("../../components/charts/compound-simulator/compound-simulator", () => ({
  CompoundSimulator: ({ defaultInitialAmount }: { defaultInitialAmount: number }) => (
    <div>初期投資額: {defaultInitialAmount}</div>
  ),
}));

const mockedGetHoldings = vi.mocked(getHoldingsWithLatestValues);

describe("SimulatorContent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("demo 環境でも投資カテゴリの合計を初期投資額に設定する", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    mockedGetHoldings.mockResolvedValue([
      { categoryName: "投資信託", amount: 1_200_000 },
      { categoryName: "投資信託", amount: 799_859 },
      { categoryName: "預金・現金", amount: 500_000 },
    ] as Awaited<ReturnType<typeof getHoldingsWithLatestValues>>);

    render(await SimulatorContent({}));

    expect(screen.getByText("初期投資額: 1999859")).toBeTruthy();
  });

  // 株式・債券・暗号資産・年金が丸ごと落ちるのが #72 の中身。
  it("投資信託以外の運用資産も初期投資額に含める", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    mockedGetHoldings.mockResolvedValue([
      { categoryName: "投資信託", amount: 2_000_000 },
      { categoryName: "株式(現物)", amount: 1_000_000 },
      { categoryName: "債券", amount: 4_000_000 },
      { categoryName: "暗号資産", amount: 300_000 },
      { categoryName: "年金", amount: 700_000 },
    ] as Awaited<ReturnType<typeof getHoldingsWithLatestValues>>);

    render(await SimulatorContent({}));

    expect(screen.getByText("初期投資額: 8000000")).toBeTruthy();
  });

  // 負債はカテゴリを持たない。数えると初期値が壊れる。
  it("運用対象でない資産と負債は初期投資額に含めない", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    mockedGetHoldings.mockResolvedValue([
      { categoryName: "投資信託", amount: 1_000_000 },
      { categoryName: "預金・現金", amount: 3_000_000 },
      { categoryName: "保険", amount: 900_000 },
      { categoryName: "ポイント", amount: 1_200 },
      { categoryName: null, amount: 250_000 },
    ] as Awaited<ReturnType<typeof getHoldingsWithLatestValues>>);

    render(await SimulatorContent({}));

    expect(screen.getByText("初期投資額: 1000000")).toBeTruthy();
  });
});
