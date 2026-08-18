#!/bin/bash
set -e

# Runs after the deployment build, before the new version starts serving.
#
# Development and production are separate databases. Until this existed, only
# development was migrated (see [postMerge] -> scripts/post-merge.sh), so every
# schema change had to be pushed to production by hand and production silently
# drifted whenever that was forgotten. That is how the `descriptor` column went
# missing and /api/people started 500ing in production only.
#
# Ordering matters: the schema is updated before the new code serves traffic,
# never after.

if [ -z "$DATABASE_URL" ]; then
  echo "WARNING: DATABASE_URL is not set in this build environment."
  echo "WARNING: Skipping the production schema push - it must be run by hand."
  echo "WARNING: If you see this, add DATABASE_URL to the deployment secrets."
else
  echo "Pushing schema to the production database..."
  # Deliberately not --force. Additive changes (new tables, new nullable
  # columns) apply on their own; anything drizzle considers destructive stops
  # the deploy instead of quietly dropping a column of somebody's diary.
  pnpm --filter db push
fi

pnpm store prune
