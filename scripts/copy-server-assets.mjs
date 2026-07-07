import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { transform } from "esbuild";

const source = join(process.cwd(), "src/server/assets");
const destination = join(process.cwd(), "dist/server/server/assets");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });

const detectorPath = join(destination, "canvas-seb-detector.js");
const detectorSource = await readFile(detectorPath, "utf8");
const minified = await transform(detectorSource, {
  format: "iife",
  legalComments: "none",
  minify: true,
  target: "es2020"
});

await writeFile(join(destination, "canvas-seb-detector.min.js"), minified.code);
