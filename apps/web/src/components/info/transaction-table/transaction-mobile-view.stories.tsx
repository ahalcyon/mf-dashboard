import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TransactionMobileView } from "./transaction-mobile-view";
import type { Transaction } from "./types";

/**
 * このコンポーネントの根は `md:hidden` なので、Storybook のテストが固定して
 * いる 1280x800 では `display: none` の部分木に入り、axe が丸ごと飛ばす。
 * 親の transaction-table.stories.tsx 経由でも同じで、モバイル表示の
 * コントラストとラベルは一度も検査されていなかった。
 *
 * ここでは表示だけを復帰させて axe に見せる。幅はデスクトップのままなので、
 * 「狭い画面での折り返し」までは見ていない。ビューポートを分けて実行する
 * 話は別途。
 */
const forceVisible = `
@media (min-width: 768px) {
  .sb-force-mobile > * {
    display: revert !important;
  }
}
`;

const meta = {
  title: "Info/TransactionTable/TransactionMobileView",
  component: TransactionMobileView,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: story 専用の静的な CSS */}
        <style dangerouslySetInnerHTML={{ __html: forceVisible }} />
        <div className="sb-force-mobile max-w-sm">
          <Story />
        </div>
      </>
    ),
  ],
} satisfies Meta<typeof TransactionMobileView>;

export default meta;
type Story = StoryObj<typeof meta>;

const tx = (
  id: number,
  date: string,
  category: string | null,
  description: string,
  amount: number,
  type: string,
  accountName: string,
  isTransfer = false,
): Transaction => ({
  id,
  date,
  category,
  description,
  amount,
  type,
  isTransfer,
  isExcludedFromCalculation: false,
  accountName,
});

export const Default: Story = {
  args: {
    transactions: [
      tx(1, "2026-07-01", "給与", "給与振込", 320000, "income", "Bank A"),
      tx(2, "2026-07-03", "食費", "スーパー", 4820, "expense", "Card A"),
      tx(3, "2026-07-05", "住宅", "家賃", 98000, "expense", "Bank A"),
      tx(4, "2026-07-08", "水道・光熱費", "電気料金", 7350, "expense", "Card A"),
    ],
  },
};

/** 振替は muted 背景と text-transfer になる。地の色との差が出るか。 */
export const Transfers: Story = {
  args: {
    transactions: [
      tx(1, "2026-07-10", null, "口座間振替", 50000, "transfer", "Bank A", true),
      tx(2, "2026-07-11", "投資", "積立投資", 30000, "expense", "Bank B", true),
    ],
  },
};

/** 説明が長い場合。truncate で切れるが、読み上げ用の情報は失われない。 */
export const LongDescription: Story = {
  args: {
    transactions: [
      tx(
        1,
        "2026-07-12",
        "特別な支出",
        "とても長い説明のついた取引でカードの幅を超えて省略される場合の見え方",
        128000,
        "expense",
        "Card A",
      ),
    ],
  },
};

/** 口座名もカテゴリも無い取引。欠損時に空欄が並ばないか。 */
export const MissingFields: Story = {
  args: {
    transactions: [tx(1, "2026-07-13", null, "", 1200, "expense", "")],
  },
};

export const Empty: Story = {
  args: { transactions: [] },
};
