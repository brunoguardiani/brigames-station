#!/usr/bin/env sh
set -eu

desktop_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_icon="$desktop_dir/src/assets/brigames-station-icon.png"
iconset_dir="$desktop_dir/build/brigames-station.iconset"
output_icon="$desktop_dir/build/brigames-station.icns"

mkdir -p "$iconset_dir"
rm -f "$output_icon"

create_icon() {
  size="$1"
  filename="$2"
  sips -z "$size" "$size" "$source_icon" --out "$iconset_dir/$filename" >/dev/null
}

create_icon 16 icon_16x16.png
create_icon 32 icon_16x16@2x.png
create_icon 32 icon_32x32.png
create_icon 64 icon_32x32@2x.png
create_icon 128 icon_128x128.png
create_icon 256 icon_128x128@2x.png
create_icon 256 icon_256x256.png
create_icon 512 icon_256x256@2x.png
create_icon 512 icon_512x512.png
create_icon 1024 icon_512x512@2x.png

iconutil -c icns "$iconset_dir" -o "$output_icon"
