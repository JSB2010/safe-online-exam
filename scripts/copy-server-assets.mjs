import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const source = join(process.cwd(), "src/server/assets");
const destination = join(process.cwd(), "dist/server/server/assets");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
