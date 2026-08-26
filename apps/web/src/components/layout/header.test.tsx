import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "../../contexts/sidebar-context";
import { DEFAULT_NOTIFICATIONS_KEY, Header } from "./header";

const { pathnameMock, refreshMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string>(() => "/"),
  refreshMock: vi.fn<() => void>(),
}));
const groups = [
  {
    id: "group-a",
    name: "Group A",
    isCurrent: true,
    lastScrapedAt: "2025-04-30T10:30:00",
  },
  {
    id: "group-b",
    name: "Group B",
    isCurrent: false,
    lastScrapedAt: "2025-04-30T15:20:00",
  },
];

vi.mock("next/navigation", () => ({
  usePathname: pathnameMock,
  useRouter: () => ({ refresh: refreshMock }),
}));

beforeEach(() => {
  pathnameMock.mockReturnValue("/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Header", () => {
  it("keeps the refresh action available when no groups exist", () => {
    render(
      <SidebarProvider>
        <Header groups={[]} defaultGroupId={null} />
      </SidebarProvider>,
    );

    expect(screen.getByRole("button", { name: "金融機関データを更新" })).not.toBeNull();
  });

  // 「グループ選択なし」は Money Forward 側の擬似グループで、切り替える先が無い。
  // 意味の分からないラベルを出し続けないようにする。
  it("hides the selector when only the no-group pseudo group exists", () => {
    render(
      <SidebarProvider>
        <Header
          groups={[{ id: "0", name: "グループ選択なし", isCurrent: true, lastScrapedAt: null }]}
          defaultGroupId="0"
        />
      </SidebarProvider>,
    );

    expect(screen.queryByText("グループ選択なし")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "グループを選択" })).toBeNull();
  });

  it("shows the selector once a real group exists alongside the pseudo group", () => {
    render(
      <SidebarProvider>
        <Header
          groups={[
            { id: "0", name: "グループ選択なし", isCurrent: true, lastScrapedAt: null },
            groups[1],
          ]}
          defaultGroupId="0"
        />
      </SidebarProvider>,
    );

    expect(screen.getByRole("combobox", { name: "グループを選択" })).not.toBeNull();
  });

  it("shows the update time for the group selected by the URL", () => {
    pathnameMock.mockReturnValue("/group-b/");

    render(
      <SidebarProvider>
        <Header groups={groups} defaultGroupId="group-a" />
      </SidebarProvider>,
    );

    expect(screen.getByText("Group B")).not.toBeNull();
    expect(
      screen.getByText((_content, element) => element?.tagName === "TIME").getAttribute("datetime"),
    ).toBe("2025-04-30T15:20:00");
    expect(screen.getByRole("button", { name: "金融機関データを更新" })).not.toBeNull();
  });

  it("falls back to the default group when the URL group is unknown", () => {
    pathnameMock.mockReturnValue("/unknown-group/");

    render(
      <SidebarProvider>
        <Header groups={groups} defaultGroupId="group-a" />
      </SidebarProvider>,
    );

    expect(screen.getByText("Group A")).not.toBeNull();
    expect(
      screen.getByText((_content, element) => element?.tagName === "TIME").getAttribute("datetime"),
    ).toBe("2025-04-30T10:30:00");
    expect(screen.getByRole("button", { name: "金融機関データを更新" })).not.toBeNull();
  });

  it("uses the configured base path for the logo", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/dashboard");

    render(
      <SidebarProvider>
        <Header groups={[]} defaultGroupId={null} />
      </SidebarProvider>,
    );

    const imageUrl = new URL(
      screen.getByRole("img", { name: "Logo" }).getAttribute("src") ?? "",
      "http://localhost",
    );
    expect(imageUrl.searchParams.get("url")).toBe("/dashboard/logo.png");
  });
});

describe("Header の通知", () => {
  const notifications = {
    [DEFAULT_NOTIFICATIONS_KEY]: <span>既定グループの通知</span>,
    "group-b": <span>Group B の通知</span>,
  };

  it("グループ id を含む URL では、そのグループの通知を出す", () => {
    pathnameMock.mockReturnValue("/group-b/bs");

    render(
      <SidebarProvider>
        <Header groups={groups} defaultGroupId="group-a" notifications={notifications} />
      </SidebarProvider>,
    );

    expect(screen.queryByText("Group B の通知")).not.toBeNull();
    expect(screen.queryByText("既定グループの通知")).toBeNull();
  });

  it("グループ id を含まない URL では、既定グループの通知を出す", () => {
    pathnameMock.mockReturnValue("/bs");

    render(
      <SidebarProvider>
        <Header groups={groups} defaultGroupId="group-a" notifications={notifications} />
      </SidebarProvider>,
    );

    expect(screen.queryByText("既定グループの通知")).not.toBeNull();
    expect(screen.queryByText("Group B の通知")).toBeNull();
  });

  it("通知を持たないグループの URL では、既定グループの通知に落とす", () => {
    pathnameMock.mockReturnValue("/group-unknown/cf");

    render(
      <SidebarProvider>
        <Header groups={groups} defaultGroupId="group-a" notifications={notifications} />
      </SidebarProvider>,
    );

    expect(screen.queryByText("既定グループの通知")).not.toBeNull();
  });
});
