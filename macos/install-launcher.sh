#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
source_file="$project_root/macos/LibreChatLauncher.m"
info_file="$project_root/macos/Info.plist"
build_directory="$project_root/macos/build"
installed_app="${1:-/Users/andresmit/Applications/LibreChat.app}"
installed_binary="$installed_app/Contents/MacOS/LibreChat"
installed_info="$installed_app/Contents/Info.plist"
module_cache="$build_directory/clang-cache"

if [[ "$installed_app" != *.app ]] || [[ ! -d "$installed_app/Contents/MacOS" ]]; then
  echo "Expected an existing macOS app bundle, received: $installed_app" >&2
  exit 1
fi

mkdir -p "$build_directory"
mkdir -p "$module_cache"

CLANG_MODULE_CACHE_PATH="$module_cache" xcrun clang \
  -fobjc-arc \
  -mmacosx-version-min=13.0 \
  "$source_file" \
  -o "$build_directory/LibreChat" \
  -framework AppKit \
  -framework WebKit

cp "$installed_binary" "$build_directory/LibreChat.previous"
cp "$installed_info" "$build_directory/Info.plist.previous"
install -m 755 "$build_directory/LibreChat" "$installed_binary"
install -m 644 "$info_file" "$installed_info"
codesign --force --deep --sign - "$installed_app"
codesign --verify --deep --strict "$installed_app"

echo "Updated $installed_app"
