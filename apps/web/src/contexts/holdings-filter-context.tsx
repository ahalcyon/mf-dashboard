"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

/**
 * 保有資産の絞り込みを bs ページ配下で共有する。
 *
 * 元は unrealized-gain-card.client.tsx に同居していたため、ページが
 * 「無関係なカードのクライアントモジュール」からプロバイダーを取りに行っていた。
 * データ取得をしないコンテキストは info/ の規約（データを取得する
 * Server Component）にも合わないので、ここへ分けている。
 */

export type GainFilter = "all" | "gain" | "loss";

/** 絞り込みなしを表す番兵。空文字は Select の未選択と区別できない。 */
export const ALL_FILTER = "__all__";

interface HoldingsFilterContextValue {
  selectedFilter: string;
  setSelectedFilter: (value: string) => void;
  gainFilter: GainFilter;
  setGainFilter: (value: GainFilter) => void;
}

const HoldingsFilterContext = createContext<HoldingsFilterContextValue | null>(null);

export function HoldingsFilterProvider({
  children,
  filterAvailable = true,
}: {
  children: ReactNode;
  filterAvailable?: boolean;
}) {
  const [selectedFilter, setSelectedFilter] = useState(ALL_FILTER);
  const [gainFilter, setGainFilter] = useState<GainFilter>("all");

  useEffect(() => {
    if (!filterAvailable) {
      setSelectedFilter(ALL_FILTER);
      setGainFilter("all");
    }
  }, [filterAvailable]);

  return (
    <HoldingsFilterContext value={{ selectedFilter, setSelectedFilter, gainFilter, setGainFilter }}>
      {children}
    </HoldingsFilterContext>
  );
}

export function useHoldingsFilter() {
  return useContext(HoldingsFilterContext);
}

export function HoldingsFilterReset() {
  const setSelectedFilter = useHoldingsFilter()?.setSelectedFilter;
  const setGainFilter = useHoldingsFilter()?.setGainFilter;

  useEffect(() => {
    setSelectedFilter?.(ALL_FILTER);
    setGainFilter?.("all");
  }, [setGainFilter, setSelectedFilter]);

  return null;
}
