#!/usr/bin/env bash
set -euo pipefail

# Allowlist: structural files with no translatable UI strings
ALLOWLIST=(
  "src/app/layout.tsx"
  "src/app/providers.tsx"
  "src/app/dashboard/layout.tsx"
  "src/components/TrackingProvider.tsx"
  "src/components/content/AboutSection.tsx"
  "src/components/content/HeroSection.tsx"
  "src/components/content/MapSection.tsx"
  "src/components/content/PhotoSection.tsx"
)

UNWIRED=$(comm -23 \
  <(find src/app src/components -name '*.tsx' | grep -vE '__tests__|\.test\.' | sort) \
  <(grep -rl 'useTranslations\|getTranslations' src/ | sort))

VIOLATIONS=""
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  skip=false
  for allowed in "${ALLOWLIST[@]}"; do
    [[ "$file" == "$allowed" ]] && skip=true && break
  done
  $skip || VIOLATIONS+="$file"$'\n'
done <<< "$UNWIRED"

if [[ -n "${VIOLATIONS}" ]]; then
  echo "❌ TSX files without i18n wiring:"
  echo "$VIOLATIONS"
  echo ""
  echo "Either wire with useTranslations/getTranslations, or add to the"
  echo "allowlist in scripts/check-i18n-coverage.sh if the file has no"
  echo "user-visible text."
  exit 1
fi

echo "✓ All TSX files are wired or allowlisted."
