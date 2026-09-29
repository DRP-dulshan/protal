/**
 * Lets `node --test` run the TypeScript sources directly. Node 24 strips type
 * annotations natively; this hook only resolves the `@/` alias and the
 * extension-less relative imports the Next.js code base uses.
 *
 *   node --import ./scripts/test-loader.mjs --test tests/
 */
import { register } from "node:module";

const hooks = `
  import { statSync } from "node:fs";
  import { fileURLToPath, pathToFileURL } from "node:url";

  const SRC = new URL("../src/", ${JSON.stringify(import.meta.url)});
  const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

  export async function resolve(specifier, context, next) {
    let base = null;
    if (specifier.startsWith("@/")) base = new URL(specifier.slice(2), SRC);
    else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:"))
      base = new URL(specifier, context.parentURL);

    if (base) {
      const path = fileURLToPath(base);
      for (const candidate of [path, path + ".ts", path + ".tsx", path + "/index.ts"]) {
        if (isFile(candidate)) return next(pathToFileURL(candidate).href, context);
      }
    }
    return next(specifier, context);
  }
`;

register("data:text/javascript," + encodeURIComponent(hooks), import.meta.url);
