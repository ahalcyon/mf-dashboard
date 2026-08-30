import { connection } from "next/server";

// 静的エクスポートではビルド時にすべて描画する
function isStaticExport() {
  return process.env.STATIC_EXPORT === "true";
}

export async function waitForRuntimeData() {
  if (isStaticExport()) return;

  await connection();
}
