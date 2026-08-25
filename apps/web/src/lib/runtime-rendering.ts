import { connection } from "next/server";

// 静的エクスポートではビルド時にすべて描画するため、実行時の接続を待たない
function isStaticExport() {
  return process.env.STATIC_EXPORT === "true";
}

export async function waitForRuntimeData() {
  if (isStaticExport()) return;

  await connection();
}
