#!/usr/bin/env bash
# Fails when the committed TypeScript bindings no longer match the Rust core.
# UniFFI hashes every exported signature and doc comment into an API checksum
# that the app verifies at startup, so stale bindings abort the app on launch.
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
rust_dir="$root_dir/packages/react-native-whip-ssh/rust"
committed="$root_dir/packages/react-native-whip-ssh/src/generated"
ubrn="$root_dir/node_modules/.bin/ubrn"
# Inside the repository so ubrn finds the project's prettier, as the real build does.
output="$root_dir/node_modules/.cache/uniffi-bindings-check"

if [[ ! -x "$ubrn" ]]; then
  echo "error: $ubrn is unavailable; install dependencies first" >&2
  exit 1
fi

# The metadata UniFFI reads is the same for every target, so a host build will do.
cargo build --lib --locked --manifest-path "$rust_dir/Cargo.toml"
target_dir="$(cargo metadata --format-version 1 --no-deps --manifest-path "$rust_dir/Cargo.toml" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')"

rm -rf "$output"
(
  cd "$rust_dir"
  "$ubrn" generate jsi bindings \
    --library \
    --ts-dir "$output/ts" \
    --cpp-dir "$output/cpp" \
    "$target_dir/debug/libwhip_ssh.a"
)

if ! diff -r "$committed" "$output/ts"; then
  echo "error: TypeScript bindings are stale; run: bash scripts/build-android-rust.sh" >&2
  exit 1
fi
echo "UniFFI bindings match the Rust core."
