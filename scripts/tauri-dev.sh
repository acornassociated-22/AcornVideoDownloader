#!/usr/bin/env bash
# Geriye uyumluluk: run.sh ile aynı.
exec "$(cd "$(dirname "$0")" && pwd)/run.sh"
