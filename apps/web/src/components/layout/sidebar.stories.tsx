import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { SidebarProvider } from "../../contexts/sidebar-context";
import { Sidebar } from "./sidebar";

const meta = {
  title: "Layout/Sidebar",
  component: Sidebar,
  tags: ["autodocs"],
  decorators: [
    (Story: () => ReactNode) => (
      <SidebarProvider>
        <div style={{ minHeight: "400px", position: "relative" }}>
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
  },
};

export const CFActive: Story = {
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/cf" } },
  },
};
