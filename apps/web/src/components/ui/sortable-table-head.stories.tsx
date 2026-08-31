import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn, expect, userEvent, within } from "storybook/test";
import { SortableTableHead } from "./sortable-table-head";
import { Table, TableHeader, TableRow } from "./table";

const meta = {
  title: "UI/SortableTableHead",
  component: SortableTableHead,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Table>
        <TableHeader>
          <TableRow>
            <Story />
          </TableRow>
        </TableHeader>
      </Table>
    ),
  ],
} satisfies Meta<typeof SortableTableHead>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InactiveColumn: Story = {
  args: {
    column: "date",
    label: "日付",
    currentSort: "amount",
    currentDirection: "desc",
    onSort: fn(),
  },
};

export const ActiveAscending: Story = {
  args: {
    column: "date",
    label: "日付",
    currentSort: "date",
    currentDirection: "asc",
    onSort: fn(),
  },
};

export const ActiveDescending: Story = {
  args: {
    column: "date",
    label: "日付",
    currentSort: "date",
    currentDirection: "desc",
    onSort: fn(),
  },
};

export const WithPlayTest: Story = {
  args: {
    column: "date",
    label: "日付",
    currentSort: "amount",
    currentDirection: "desc",
    onSort: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const button = canvas.getByRole("button", { name: /日付/ });
    await userEvent.click(button);

    await expect(args.onSort).toHaveBeenCalledWith("date");
  },
};
