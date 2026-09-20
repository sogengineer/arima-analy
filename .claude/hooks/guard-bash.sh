#!/bin/bash
# PreToolUse(Bash): このリポの規約違反・危険コマンドをブロックする（事故防止のガードレール）
#
# 方針:
# - 攻撃者対策ではなく、うっかり事故の防止。正規表現 + 素朴なトークン分割で検出する
# - シェル構文の完全なパーサは書かない
# - 解析できない入力（jq 不在・JSON 不正）は安全側に倒してブロックする（fail-closed）
#
# 既知の限界（意図的に対応しないもの）:
# - 引用文字列の中に危険語があると誤ブロックすることがある（例: echo "git push --force"、
#   コミットメッセージや grep の検索語）。安全側の誤爆として許容する
# - 変数展開・エイリアス・間接実行（VAR="git push --force"; $VAR）は検出しない
# - glob（prod.d?）やディレクトリ再帰削除（rm -rf data/）経由の DB 削除は検出しない
# - 引用符で空白を含むファイル名（"test-alpha beta.db"）はトークン分割で壊れるため、
#   テスト用 DB であってもブロックされる（安全側）
# - 型チェックの検出は `bun c` のトークン一致。`bun "c"` のような引用符つき表記は
#   引用符を剥がして判定するため検出できるが、`bun ${VAR}` のような間接指定は検出しない

set -u
set -f  # 引数のグロブ展開を無効化（rm *.db などをそのまま扱う）

block() {
  echo "$1" >&2
  echo "（誤検出の場合は、コマンドをスクリプトファイルに書いて実行してください）" >&2
  exit 2
}

input=$(cat)

# --- 入力の解析（失敗時は素通りさせず安全側に倒す） ---
if ! command -v jq >/dev/null 2>&1; then
  block "ブロック: jq が見つからないため Bash コマンドを検査できません（安全側でブロックしました）。"
fi

if ! cmd=$(printf '%s' "$input" | jq -r 'if type == "object" then (.tool_input.command // "") else error("tool_input is not an object") end' 2>/dev/null); then
  block "ブロック: フック入力の JSON を解析できませんでした（安全側でブロックしました）。"
fi

# command キーが正当に空／無い場合だけ通す
[ -z "$cmd" ] && exit 0

# --- 補助関数 ---
strip_quotes() {
  local t=$1
  while :; do
    case "$t" in
      \"*) t=${t#\"} ;;
      \'*) t=${t#\'} ;;
      *) break ;;
    esac
  done
  while :; do
    case "$t" in
      *\") t=${t%\"} ;;
      *\') t=${t%\'} ;;
      *) break ;;
    esac
  done
  printf '%s' "$t"
}

base_of() {
  local p
  p=$(strip_quotes "$1")
  printf '%s' "${p##*/}"
}

# --- 1. 環境変数ファイル実体の読み書き禁止（example 雛形のみ完全一致で許可） ---
env_hits=$(printf '%s' "$cmd" | grep -oE '(^|[[:space:]/"'"'"'<>=])\.env[A-Za-z0-9_.-]*' || true)
if [ -n "$env_hits" ]; then
  while IFS= read -r raw; do
    [ -z "$raw" ] && continue
    case "$raw" in
      .*) tok=$raw ;;
      *) tok=${raw#?} ;;
    esac
    case "$tok" in
      .env.example|.env.sample) ;;
      *) block "ブロック: 環境変数ファイル実体（${tok}）へのアクセスは禁止です（.env.example を使ってください）。" ;;
    esac
  done <<< "$env_hits"
fi

# --- 2. コマンド区間ごとの検査 ---
# ; & && | || ( ) で区切った「単純コマンド区間」単位で見る。
# これにより `rm scratch.txt && sqlite3 prod.db "select 1"` を誤ブロックしない。
segments=$(printf '%s' "$cmd" | tr ';&|()\n' '\n\n\n\n\n\n')

check_git() {
  # $@ = git 以降のトークン列（git 自体を含まない）
  local sub="" seen_sub=0
  local a
  # グローバルオプションを読み飛ばしてサブコマンドを取る
  while [ $# -gt 0 ]; do
    a=$(strip_quotes "$1")
    case "$a" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path)
        shift 2 2>/dev/null || shift
        continue
        ;;
      -*)
        shift
        continue
        ;;
      *)
        sub=$a
        seen_sub=1
        shift
        break
        ;;
    esac
  done
  [ "$seen_sub" -eq 1 ] || return 0

  case "$sub" in
    push)
      for a in "$@"; do
        a=$(strip_quotes "$a")
        case "$a" in
          --force-with-lease|--force-with-lease=*|--force-if-includes) ;;
          --force)
            block "ブロック: git push --force は禁止です。必要なら --force-with-lease をユーザーに相談してください。" ;;
          -[a-zA-Z]*)
            case "$a" in
              *f*) block "ブロック: git push の強制オプション（${a}）は禁止です。必要なら --force-with-lease をユーザーに相談してください。" ;;
            esac
            ;;
          +*)
            block "ブロック: 先頭 + の refspec（${a}）は強制 push です。必要なら --force-with-lease をユーザーに相談してください。" ;;
        esac
      done
      ;;
    reset)
      for a in "$@"; do
        a=$(strip_quotes "$a")
        if [ "$a" = "--hard" ]; then
          block "ブロック: git reset --hard は作業ツリーを破壊します。実行前にユーザーに確認してください。"
        fi
      done
      ;;
    clean)
      for a in "$@"; do
        a=$(strip_quotes "$a")
        case "$a" in
          --force)
            block "ブロック: git clean --force は作業ツリーを破壊します。実行前にユーザーに確認してください。" ;;
          -[a-zA-Z]*)
            case "$a" in
              *f*) block "ブロック: git clean の強制オプション（${a}）は作業ツリーを破壊します。実行前にユーザーに確認してください。" ;;
            esac
            ;;
        esac
      done
      ;;
  esac
}

check_rm() {
  # $@ = rm 以降のトークン列。SQLite DB の削除を禁止（テスト用一時 DB test-*.db のみ許可）
  local a b
  for a in "$@"; do
    a=$(strip_quotes "$a")
    case "$a" in
      -*) continue ;;
    esac
    b=${a##*/}
    case "$b" in
      *.db)
        case "$b" in
          test-*) ;;
          *) block "ブロック: SQLite DB ファイル（${a}）の削除は禁止です。削除してよいのはテスト用一時 DB（test-*.db）だけです。" ;;
        esac
        ;;
    esac
  done
}

while IFS= read -r seg; do
  [ -z "$seg" ] && continue
  # shellcheck disable=SC2206
  toks=($seg)
  n=${#toks[@]}
  [ "$n" -eq 0 ] && continue

  git_at=-1
  rm_at=-1
  bun_at=-1
  i=0
  while [ $i -lt "$n" ]; do
    b=$(base_of "${toks[$i]}")
    case "$b" in
      git) [ $git_at -lt 0 ] && git_at=$i ;;
      rm) [ $rm_at -lt 0 ] && rm_at=$i ;;
      bun) [ $bun_at -lt 0 ] && bun_at=$i ;;
    esac
    i=$((i + 1))
  done

  # 規約: 型チェックは `bun run c`。`bun c` は bun create と解釈されて失敗する（docs/DEVELOPMENT.md）
  if [ $bun_at -ge 0 ] && [ $((bun_at + 1)) -lt "$n" ]; then
    next=$(strip_quotes "${toks[$((bun_at + 1))]}")
    if [ "$next" = "c" ]; then
      block "ブロック: 'bun c' は bun create と解釈されて失敗します。型チェックは 'bun run c' を使ってください。"
    fi
  fi

  if [ $git_at -ge 0 ] && [ $((git_at + 1)) -lt "$n" ]; then
    check_git "${toks[@]:$((git_at + 1))}"
  fi

  if [ $rm_at -ge 0 ] && [ $((rm_at + 1)) -lt "$n" ]; then
    check_rm "${toks[@]:$((rm_at + 1))}"
  fi
done <<< "$segments"

exit 0
