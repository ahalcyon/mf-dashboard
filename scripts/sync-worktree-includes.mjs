#!/usr/bin/env node
// `.worktreeinclude` に書いたローカル設定を、リンク済み worktree へ引き写す。
// post-checkout フックから呼ばれる。既にあるファイルは触らない。

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, globSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const INCLUDE_FILE = ".worktreeinclude";

// git の外や壊れた状態では黙って終わる。
function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/** リンク済み worktree では git-dir が common-dir の配下に置かれる。 */
function findPrimaryWorktree(cwd) {
  const gitDir = path.resolve(cwd, git(["rev-parse", "--git-dir"], cwd));
  const commonDir = path.resolve(cwd, git(["rev-parse", "--git-common-dir"], cwd));
  if (gitDir === commonDir) return null;

  // `git worktree list --porcelain` の最初の worktree が primary
  const listing = git(["worktree", "list", "--porcelain"], cwd);
  const first = listing.split("\n").find((line) => line.startsWith("worktree "));
  return first ? first.slice("worktree ".length) : null;
}

/**
 * `.worktreeinclude` を読む。
 *
 * 対応するのは「リポジトリルートからの相対パスと glob」および `!` による除外。
 * .gitignore の全機能ではない。実際に必要なのは明示パスだけで、完全な
 * gitignore 実装を持ち込むと、何がコピーされるか読んで分からなくなる。
 */
function readPatterns(root) {
  const file = path.join(root, INCLUDE_FILE);
  if (!existsSync(file)) return null;

  const include = [];
  const exclude = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("!")) {
      exclude.push(line.slice(1));
    } else {
      include.push(line);
    }
  }
  return { include, exclude };
}

function resolveMatches(root, patterns) {
  const excluded = new Set(patterns.exclude.flatMap((pattern) => globSync(pattern, { cwd: root })));

  const matches = new Set();
  for (const pattern of patterns.include) {
    for (const match of globSync(pattern, { cwd: root })) {
      if (excluded.has(match)) continue;
      // ディレクトリごと運ぶ用途は想定しない。生成物を持ち込む事故のもとになる。
      if (statSync(path.join(root, match)).isDirectory()) continue;
      matches.add(match);
    }
  }
  return [...matches].sort((a, b) => a.localeCompare(b));
}

function main() {
  const cwd = process.cwd();

  let primary;
  try {
    primary = findPrimaryWorktree(cwd);
  } catch {
    return; // git の外。フックを失敗させる理由はない。
  }
  if (!primary) return;

  const target = git(["rev-parse", "--show-toplevel"], cwd);
  if (path.resolve(primary) === path.resolve(target)) return;

  const patterns = readPatterns(primary);
  if (!patterns) return;

  // 列挙しても primary に無いものは黙って飛ばす。glob は存在するパスしか
  // 返さないので、ここへ来る時点で from は必ずある。
  const copied = [];
  for (const relative of resolveMatches(primary, patterns)) {
    const to = path.join(target, relative);
    if (existsSync(to)) continue;

    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(path.join(primary, relative), to);
    copied.push(relative);
  }

  if (copied.length > 0) {
    console.log(`Copied ${copied.length} local file(s) from ${primary}:`);
    for (const relative of copied) console.log(`  ${relative}`);
  }
}

main();
