#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$PROJECT_DIR/data/e2e-crawler.log"
MISE_SHIMS="$HOME/.local/share/mise/shims"

export PATH="$MISE_SHIMS:$PATH"

cd "$PROJECT_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================="
echo "$(date '+%Y-%m-%d %H:%M:%S') Starting e2e-crawler"
echo "=========================================="

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# 本文は SNS の Message へそのまま入れる。Subject は ASCII のみ 100 文字以内という
# SNS の制約があるため、日本語を入れずに固定文字列で組み立てる。
publish_notification() {
  local subject="$1"
  local message="$2"

  if [ -z "${NOTIFICATION_TOPIC_ARN:-}" ]; then
    return 0
  fi

  if ! command -v aws > /dev/null 2>&1; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') aws CLI not found, skipping notification"
    return 0
  fi

  if ! aws sns publish \
    --topic-arn "$NOTIFICATION_TOPIC_ARN" \
    --subject "$subject" \
    --message "$message" \
    --output text > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') Failed to publish the notification"
  fi
}

build_failure_summary() {
  local run_log="$1"

  perl -pe 's/\e\[[0-9;]*[A-Za-z]//g' "$run_log" |
    awk '
      function emit(line) {
        remaining = 2500 - output_length
        if (remaining <= 0) {
          return
        }
        line = substr(line, 1, remaining)
        print line
        output_length += length(line) + 1
      }
      /^ FAIL / {
        emit($0)
        capture_error = 1
        next
      }
      capture_error && /^(AssertionError|TimeoutError|[A-Za-z]+Error:|Error:)/ {
        emit($0)
        capture_error = 0
        next
      }
      /^ Test Files / || /^      Tests / || /^   Duration / {
        emit($0)
      }
    '
}

RUN_LOG=$(mktemp "${TMPDIR:-/tmp}/mf-dashboard-e2e.XXXXXX")
trap 'rm -f "$RUN_LOG"' EXIT

if pnpm --filter @mf-dashboard/crawler test:e2e 2>&1 | tee "$RUN_LOG"; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') E2E tests passed"
  publish_notification "Crawler E2E passed" "Crawler E2E テストが成功しました"
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') E2E tests failed"

  failure_summary=$(build_failure_summary "$RUN_LOG")
  if [ -z "$failure_summary" ]; then
    failure_summary="失敗内容を抽出できませんでした。ローカルログを確認してください。"
  fi

  publish_notification "Crawler E2E failed" "$(printf 'Crawler E2E テストが失敗しました\n\n%s' "$failure_summary")"

  exit 1
fi
