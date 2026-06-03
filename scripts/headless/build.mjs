// Bundle the engine for headless Node execution: alias pixi.js to a no-op stub so
// the deterministic sim can be stepped at full speed without a browser/renderer.
import { build } from "esbuild";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

await build({
  entryPoints: [path.join(root, "src/game/Game.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: path.join(here, ".game-headless.mjs"),
  alias: { "pixi.js": path.join(here, "pixi-stub.js") },
  plugins: [{
    name: "stub-io",
    setup(b) {
      b.onResolve({ filter: /(\/|^)(audio|input)$/ }, (args) => {
        if (!args.importer.includes(`${path.sep}src${path.sep}game${path.sep}`)) return;
        const which = args.path.endsWith("audio") ? "audio-stub.js" : "input-stub.js";
        return { path: path.join(here, which) };
      });
    },
  }],
  logLevel: "warning",
});
console.log("built scripts/headless/.game-headless.mjs");
