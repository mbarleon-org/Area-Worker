#!/usr/bin/env sh
set -eu

mkdir -p ./src/api/
cp -f external/Backend/src/api/engine.ts ./src/api/

mkdir -p ./src/modules/
cp -f external/Backend/src/modules/_module.spec.ts ./src/modules/
cp -f external/Backend/src/modules/registry.ts ./src/modules/
cp -f external/Backend/src/modules/runner.ts ./src/modules/
