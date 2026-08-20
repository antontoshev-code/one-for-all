import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards the OpenAPI spec against silently falling behind the server.
 *
 * The spec is meant to be the source of truth — orval generates the Zod schemas
 * and the React client from it. It had drifted to describing 8 of 26 routes,
 * and nothing anywhere said so, which is the real problem: a partial spec that
 * looks complete is worse than an obviously empty one, because it gets trusted.
 *
 * Reads both as text rather than importing the server: the route modules pull
 * in the database, and this needs to run without one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = join(here, "../../../../lib/api-spec/openapi.yaml");

/**
 * Routes deliberately outside the generated client, with the reason. Anything
 * not listed here must appear in the spec — add a route to one or the other on
 * purpose, never by forgetting.
 */
const INTENTIONALLY_UNDOCUMENTED: Record<string, string> = {
  "post /ai/transcribe": "multipart audio upload; the generated fetch client does not model it",
  "post /ai/categorize": "AI helper, called directly and tolerant of failure by design",
  "post /ai/detect-names": "AI helper, called directly and tolerant of failure by design",
  "post /ai/split": "AI helper, called directly and tolerant of failure by design",
  "get /ai/status": "diagnostic surface for Settings, not part of the data contract",
  "get /": "platform healthcheck probe, not an application endpoint",
};

function routesFromSource(): string[] {
  const dir = here;
  const found: string[] = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(dir, file), "utf8");
    for (const m of source.matchAll(/router\.(get|post|patch|put|delete)\("([^"]+)"/g)) {
      // Express ":id" and OpenAPI "{id}" are the same thing spelled differently.
      const path = m[2].replace(/:(\w+)/g, "{$1}");
      found.push(`${m[1]} ${path}`);
    }
  }

  return [...new Set(found)].sort();
}

function pathsFromSpec(): Set<string> {
  const spec = readFileSync(SPEC, "utf8");
  const paths = new Set<string>();
  let inPaths = false;

  for (const line of spec.split("\n")) {
    if (/^paths:/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^\S/.test(line)) break;          // dedented out of paths:
    const m = /^ {2}(\/\S*):\s*$/.exec(line);
    if (m) paths.add(m[1]);
  }

  return paths;
}

describe("OpenAPI spec coverage", () => {
  test("the spec parses and describes some paths", () => {
    // If the extraction breaks, every other assertion here passes vacuously.
    const paths = pathsFromSpec();
    assert.ok(paths.size > 0, "no paths extracted from openapi.yaml");
    assert.ok(paths.has("/entries"), "expected /entries in the spec");
  });

  test("the route scan finds routes", () => {
    const routes = routesFromSource();
    assert.ok(routes.length > 10, `only found ${routes.length} routes`);
  });

  test("every route is documented or deliberately excluded", () => {
    const specPaths = pathsFromSpec();
    const undocumented = routesFromSource().filter(route => {
      if (route in INTENTIONALLY_UNDOCUMENTED) return false;
      const path = route.slice(route.indexOf(" ") + 1);
      return !specPaths.has(path);
    });

    assert.deepEqual(
      undocumented,
      [],
      `These routes are in neither the spec nor the exclusion list.\n` +
      `Add them to lib/api-spec/openapi.yaml, or to INTENTIONALLY_UNDOCUMENTED with a reason:\n  ` +
      undocumented.join("\n  "),
    );
  });

  test("the exclusion list has no stale entries", () => {
    // An exclusion for a route that no longer exists is a comment pretending
    // to be a decision.
    const routes = new Set(routesFromSource());
    const stale = Object.keys(INTENTIONALLY_UNDOCUMENTED).filter(r => !routes.has(r));
    assert.deepEqual(stale, [], `Exclusions for routes that no longer exist: ${stale.join(", ")}`);
  });
});
