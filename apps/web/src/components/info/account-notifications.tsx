import { getAccountsWithAssets } from "@mf-dashboard/db";
import { buildBalanceForecastAlerts } from "./account-notifications-data";
import { AccountNotificationsClient } from "./account-notifications.client";
import { getBankCashFlowForecastViews } from "./bank-cashflow-forecast";

interface AccountNotificationsProps {
  /** 未指定なら現在グループ。`getAccountsWithAssets` と解決規則を揃える。 */
  groupId?: string;
}

export async function AccountNotifications({ groupId }: AccountNotificationsProps = {}) {
  const [accounts, forecasts] = await Promise.all([
    getAccountsWithAssets(groupId),
    getBankCashFlowForecastViews(groupId),
  ]);
  const errorAccounts = accounts.filter((a) => a.status === "error");
  const updatingAccounts = accounts.filter((a) => a.status === "updating");
  const balanceAlerts = buildBalanceForecastAlerts(forecasts);
  const totalIssues = errorAccounts.length + updatingAccounts.length + balanceAlerts.length;

  return (
    <AccountNotificationsClient
      errorAccounts={errorAccounts}
      updatingAccounts={updatingAccounts}
      balanceAlerts={balanceAlerts}
      totalIssues={totalIssues}
    />
  );
}
