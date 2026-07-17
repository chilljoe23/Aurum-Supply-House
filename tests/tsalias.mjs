// Module-resolution hook for `npm test`: maps the app's "@/…" TypeScript path
// alias (tsconfig `paths`) to the real src/ files so pure modules that use the
// project's normal import style can be unit-tested under Node's built-in test
// runner + type-stripping, with zero extra dependencies. Only "@/" specifiers
// are intercepted; everything else passes straight through.
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "src");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = join(SRC, specifier.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
