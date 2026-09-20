#!/bin/bash
# Stop: ターン終了時に型チェック（bun run c）。失敗なら exit 2 でブロックし Claude に修正させる
#
# 実行条件: HEAD との差分または未追跡ファイルに .ts / .tsx がある間は毎ターン実行する
#           （「このターンの変更だけ」を判定しているわけではない）。
#           git コマンド自体が失敗した場合（非 git ディレクトリ・HEAD 不在など）は
#           判定できないのでスキップせずフルチェックする。
#
# 環境異常（CLAUDE_PROJECT_DIR 未設定・cd 失敗・jq 不在・JSON 不正・bun 不在）では、
# Stop フックで停止不能ループを作らないよう診断を stderr に出して exit 0 する（無言では終わらない）。
#
# 既知の限界:
# - 型チェックが settings.json の timeout（120秒）を超えると、このスクリプト側では
#   制御できずフックが打ち切られる（内部タイムアウトは持たない）
# - 失敗出力は末尾 40 行のみ。バイト数での制限はしない

set -u

input=$(cat)

# Stop フック起因の再実行では走らせない（無限ループ防止）
if ! command -v jq >/dev/null 2>&1; then
  echo "typecheck フック: jq が無いため stop_hook_active を判定できません。無限ループ防止を優先してスキップします。" >&2
  exit 0
fi

if ! stop_hook_active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null); then
  echo "typecheck フック: フック入力の JSON を解析できませんでした。無限ループ防止を優先してスキップします。" >&2
  exit 0
fi
[ "$stop_hook_active" = "true" ] && exit 0

project_dir=${CLAUDE_PROJECT_DIR:-}
if [ -z "$project_dir" ]; then
  echo "typecheck フック: CLAUDE_PROJECT_DIR が未設定のため型チェックをスキップします。" >&2
  exit 0
fi

if ! cd "$project_dir" 2>/dev/null; then
  echo "typecheck フック: CLAUDE_PROJECT_DIR（${project_dir}）に移動できないため型チェックをスキップします。" >&2
  exit 0
fi

# 変更検出: HEAD との差分 + 未追跡ファイル。git が使えない場合は判定せずフルチェックへ進む
git_ok=1
tracked=$(git diff --name-only HEAD 2>/dev/null) || git_ok=0
untracked=$(git ls-files --others --exclude-standard 2>/dev/null) || git_ok=0

if [ "$git_ok" -eq 1 ]; then
  if ! printf '%s\n%s\n' "$tracked" "$untracked" | grep -qE '\.tsx?$'; then
    exit 0
  fi
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "typecheck フック: bun が見つからないため型チェックをスキップします。" >&2
  exit 0
fi

# 注: `bun c` は bun create と解釈されるため必ず `bun run c`
if ! output=$(bun run c 2>&1); then
  echo "型チェック（bun run c）が失敗しています。修正してください:" >&2
  echo "$output" | tail -40 >&2
  exit 2
fi
exit 0
