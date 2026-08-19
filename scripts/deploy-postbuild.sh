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
  pnpm store prune
  exit 0
fi

# The production database is idle between deploys, and its compute endpoint
# suspends. The first connection after a gap can fail outright — "The endpoint
# has been disabled" — while it wakes, and that failure is indistinguishable
# from a real one if you only try once. So try a few times, spacing the
# attempts out enough for a cold start to finish.
#
# Deliberately not --force. Additive changes (new tables, new nullable columns)
# apply on their own; anything drizzle considers destructive stops the deploy
# instead of quietly dropping a column of somebody's diary. A destructive change
# fails identically on every attempt, so retrying costs a few seconds and
# changes nothing.
attempt=1
max_attempts=4

until pnpm --filter db push; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "ERROR: Schema push failed $max_attempts times."
    echo "ERROR: If the message mentions a disabled endpoint, the production"
    echo "ERROR: database never woke up. If it mentions a destructive change,"
    echo "ERROR: that is deliberate - review it and push by hand."
    exit 1
  fi

  delay=$((attempt * 10))
  echo "Schema push attempt $attempt failed; waiting ${delay}s for the database to wake..."
  sleep "$delay"
  attempt=$((attempt + 1))
done

echo "Schema push succeeded on attempt $attempt."

pnpm store prune
