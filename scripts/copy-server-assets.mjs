import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";

const source = join(process.cwd(), "src/server/assets");
const destination = join(process.cwd(), "dist/server/server/assets");
const migrationsSource = join(process.cwd(), "src/server/data/migrations");
const migrationsDestination = join(process.cwd(), "dist/server/server/data/migrations");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
await mkdir(migrationsDestination, { recursive: true });
await cp(migrationsSource, migrationsDestination, { recursive: true });

const detectorPath = join(destination, "canvas-seb-detector.js");
const detectorDirectory = join(source, "detector");
const detectorSourceModuleUrl = pathToFileURL(join(process.cwd(), "dist/server/server/services/detector-source.js"));
const { readDetectorSource } = await import(detectorSourceModuleUrl.href);
const detectorSource = await readDetectorSource(detectorDirectory);
await writeFile(detectorPath, detectorSource);
const minified = await transform(detectorSource, {
  format: "iife",
  legalComments: "none",
  minify: true,
  target: "es2020"
});

await writeFile(join(destination, "canvas-seb-detector.min.js"), minified.code);
