import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  doublePrecision,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ============================================================================
// マスタ系
// ============================================================================

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isCurrent: boolean("is_current").default(false),
  lastScrapedAt: text("last_scraped_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// グループとアカウントの多対多関係を管理する中間テーブル
export const groupAccounts = pgTable(
  "group_accounts",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("group_accounts_group_account_idx").on(table.groupId, table.accountId),
    index("group_accounts_group_id_idx").on(table.groupId),
    index("group_accounts_account_id_idx").on(table.accountId),
  ],
);

export const institutionCategories = pgTable("institution_categories", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull().unique(),
  displayOrder: integer("display_order"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    mfId: text("mf_id").notNull().unique(),
    name: text("name").notNull(),
    type: text("type").notNull(), // "自動連携" / "手動"
    institution: text("institution"),
    categoryId: integer("category_id").references(() => institutionCategories.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    isActive: boolean("is_active").default(true),
  },
  (table) => [index("accounts_category_id_idx").on(table.categoryId)],
);

export const assetCategories = pgTable("asset_categories", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ============================================================================
// ステータス系
// ============================================================================

// アカウントステータス（常に最新状態をupsert）
export const accountStatuses = pgTable("account_statuses", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  accountId: integer("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // "ok" / "error" / "updating" / "suspended" / "unknown"
  lastUpdated: text("last_updated"), // ISO 8601形式
  totalAssets: integer("total_assets").default(0), // /accountsページから取得した資産額
  scheduledWithdrawalAmount: integer("scheduled_withdrawal_amount"),
  scheduledWithdrawalConfirmed: boolean("scheduled_withdrawal_confirmed").notNull().default(false),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ============================================================================
// 銘柄・資産マスタ
// ============================================================================

// 銘柄マスタ（資産と負債を統一管理）
// Note: No unique constraint on (accountId, name, type) to allow duplicates
// (e.g., same fund in NISA/特定/一般 accounts)
export const holdings = pgTable(
  "holdings",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    mfId: text("mf_id").unique(), // MFの識別子（ない場合もある）
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => assetCategories.id, {
      onDelete: "set null",
    }), // 負債はnull
    name: text("name").notNull(),
    code: text("code"), // 銘柄コード（株式のみ）
    type: text("type").notNull(), // "asset" | "liability"
    liabilityCategory: text("liability_category"), // 負債の場合のカテゴリ（カード、ローン等）
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    isActive: boolean("is_active").default(true),
  },
  (table) => [index("holdings_account_id_idx").on(table.accountId)],
);

// ============================================================================
// スナップショット系
// ============================================================================

export const dailySnapshots = pgTable(
  "daily_snapshots",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    refreshCompleted: boolean("refresh_completed").default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("daily_snapshots_date_idx").on(table.date)],
);

// 銘柄の日次評価額
export const holdingValues = pgTable(
  "holding_values",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    holdingId: integer("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => dailySnapshots.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(), // 評価額
    quantity: doublePrecision("quantity"), // 数量（株式・投信）
    unitPrice: doublePrecision("unit_price"), // 単価
    avgCostPrice: doublePrecision("avg_cost_price"), // 平均取得単価
    dailyChange: integer("daily_change"), // 前日比（円）
    unrealizedGain: integer("unrealized_gain"), // 含み損益
    unrealizedGainPct: doublePrecision("unrealized_gain_pct"), // 含み損益率
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("holding_values_holding_snapshot_idx").on(table.holdingId, table.snapshotId),
  ],
);

// ============================================================================
// 収支系
// ============================================================================

export const transactions = pgTable(
  "transactions",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    mfId: text("mf_id").notNull().unique(),
    date: text("date").notNull(),
    accountId: integer("account_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),
    category: text("category"), // 大項目 null = 振替（カテゴリなし）
    subCategory: text("sub_category"), // 中項目
    description: text("description"),
    amount: integer("amount").notNull(),
    type: text("type").notNull(), // "income" / "expense" / "transfer"
    isTransfer: boolean("is_transfer").notNull().default(false),
    isExcludedFromCalculation: boolean("is_excluded_from_calculation").notNull().default(false), // mf-grayout class
    transferTarget: text("transfer_target"),
    transferTargetAccountId: integer("transfer_target_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("transactions_date_idx").on(table.date),
    index("transactions_account_id_idx").on(table.accountId),
  ],
);

export const cashFlowPeriods = pgTable(
  "cash_flow_periods",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    month: text("month").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("cash_flow_periods_month_idx").on(table.month)],
);

export const bankForecastDismissals = pgTable(
  "bank_forecast_dismissals",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["income", "expense"] }).notNull(),
    recurringIdentity: text("recurring_identity").notNull(),
    dismissedThroughDate: text("dismissed_through_date").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("bank_forecast_dismissals_candidate_idx").on(
      table.accountId,
      table.direction,
      table.recurringIdentity,
    ),
    index("bank_forecast_dismissals_account_id_idx").on(table.accountId),
  ],
);

export const bankForecastManualEvents = pgTable(
  "bank_forecast_manual_events",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    amount: integer("amount").notNull(),
    direction: text("direction", { enum: ["income", "expense"] }).notNull(),
    description: text("description").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("bank_forecast_manual_events_group_account_date_idx").on(
      table.groupId,
      table.accountId,
      table.date,
    ),
  ],
);

// ============================================================================
// 資産履歴系
// ============================================================================

export const assetHistory = pgTable(
  "asset_history",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    totalAssets: integer("total_assets").notNull(),
    change: integer("change").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("asset_history_group_date_idx").on(table.groupId, table.date),
    index("asset_history_group_id_idx").on(table.groupId),
  ],
);

export const assetHistoryCategories = pgTable(
  "asset_history_categories",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    assetHistoryId: integer("asset_history_id")
      .notNull()
      .references(() => assetHistory.id, { onDelete: "cascade" }),
    categoryName: text("category_name").notNull(),
    amount: integer("amount").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("asset_history_categories_history_category_idx").on(
      table.assetHistoryId,
      table.categoryName,
    ),
  ],
);

// ============================================================================
// 予算系
// ============================================================================

export const spendingTargets = pgTable(
  "spending_targets",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    largeCategoryId: integer("large_category_id").notNull(),
    categoryName: text("category_name").notNull(),
    type: text("type").notNull(), // "fixed" | "variable"
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("spending_targets_group_category_idx").on(table.groupId, table.largeCategoryId),
    index("spending_targets_group_id_idx").on(table.groupId),
  ],
);

// ============================================================================
// リレーション定義
// ============================================================================

export const groupsRelations = relations(groups, ({ many }) => ({
  snapshots: many(dailySnapshots),
  groupAccounts: many(groupAccounts),
  assetHistories: many(assetHistory),
  spendingTargets: many(spendingTargets),
}));

export const groupAccountsRelations = relations(groupAccounts, ({ one }) => ({
  group: one(groups, {
    fields: [groupAccounts.groupId],
    references: [groups.id],
  }),
  account: one(accounts, {
    fields: [groupAccounts.accountId],
    references: [accounts.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ many, one }) => ({
  holdings: many(holdings),
  status: one(accountStatuses, {
    fields: [accounts.id],
    references: [accountStatuses.accountId],
  }),
  transactions: many(transactions),
  groupAccounts: many(groupAccounts),
  bankForecastDismissals: many(bankForecastDismissals),
  bankForecastManualEvents: many(bankForecastManualEvents),
}));

export const accountStatusesRelations = relations(accountStatuses, ({ one }) => ({
  account: one(accounts, {
    fields: [accountStatuses.accountId],
    references: [accounts.id],
  }),
}));

export const holdingsRelations = relations(holdings, ({ one, many }) => ({
  account: one(accounts, {
    fields: [holdings.accountId],
    references: [accounts.id],
  }),
  category: one(assetCategories, {
    fields: [holdings.categoryId],
    references: [assetCategories.id],
  }),
  values: many(holdingValues),
}));

export const dailySnapshotsRelations = relations(dailySnapshots, ({ one, many }) => ({
  group: one(groups, {
    fields: [dailySnapshots.groupId],
    references: [groups.id],
  }),
  holdingValues: many(holdingValues),
}));

export const holdingValuesRelations = relations(holdingValues, ({ one }) => ({
  holding: one(holdings, {
    fields: [holdingValues.holdingId],
    references: [holdings.id],
  }),
  snapshot: one(dailySnapshots, {
    fields: [holdingValues.snapshotId],
    references: [dailySnapshots.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
}));

export const bankForecastDismissalsRelations = relations(bankForecastDismissals, ({ one }) => ({
  account: one(accounts, {
    fields: [bankForecastDismissals.accountId],
    references: [accounts.id],
  }),
}));

export const bankForecastManualEventsRelations = relations(bankForecastManualEvents, ({ one }) => ({
  group: one(groups, {
    fields: [bankForecastManualEvents.groupId],
    references: [groups.id],
  }),
  account: one(accounts, {
    fields: [bankForecastManualEvents.accountId],
    references: [accounts.id],
  }),
}));

export const assetHistoryRelations = relations(assetHistory, ({ one, many }) => ({
  group: one(groups, {
    fields: [assetHistory.groupId],
    references: [groups.id],
  }),
  categories: many(assetHistoryCategories),
}));

export const assetHistoryCategoriesRelations = relations(assetHistoryCategories, ({ one }) => ({
  assetHistory: one(assetHistory, {
    fields: [assetHistoryCategories.assetHistoryId],
    references: [assetHistory.id],
  }),
}));

export const spendingTargetsRelations = relations(spendingTargets, ({ one }) => ({
  group: one(groups, {
    fields: [spendingTargets.groupId],
    references: [groups.id],
  }),
}));

// ============================================================================
// 分析系
// ============================================================================

export const analyticsReports = pgTable(
  "analytics_reports",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    // LLM生成コンテンツ
    summary: text("summary"),
    savingsInsight: text("savings_insight"),
    investmentInsight: text("investment_insight"),
    spendingInsight: text("spending_insight"),
    balanceInsight: text("balance_insight"),
    liabilityInsight: text("liability_insight"),
    // メタデータ
    model: text("model"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("analytics_reports_group_date_idx").on(table.groupId, table.date),
    index("analytics_reports_group_id_idx").on(table.groupId),
  ],
);

export const analyticsReportsRelations = relations(analyticsReports, ({ one }) => ({
  group: one(groups, {
    fields: [analyticsReports.groupId],
    references: [groups.id],
  }),
}));
