/**
 * ESM resolve hook: lets the plain-.mjs scripts in scripts/ import the project's
 * TypeScript sources directly.
 *
 * src/ is written for the Remotion bundler ("moduleResolution": "Bundler"), so
 * its relative imports are extensionless. Node 24 strips TS types natively but
 * still demands a full specifier, so this hook retries a failed relative
 * resolution with ".ts" / ".tsx" / "/index.ts" appended.
 *
 * The alternative was a tsx/esbuild dev-dependency just to read four constants —
 * this keeps the toolchain at zero extra packages.
 */
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!relative || /\.[cm]?[jt]sx?$/.test(specifier)) throw err;
    for (const ext of CANDIDATES) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch {
        /* try the next candidate */
      }
    }
    throw err;
  }
}
