import { transformSync, version } from "esbuild";

if (version !== "0.28.1") {
  throw new Error(`Unexpected esbuild version after trusted rebuild: ${version}`);
}

const result = transformSync("const answer: number = 42", {
  loader: "ts",
  format: "esm"
});

if (!result.code.includes("const answer = 42")) {
  throw new Error("The trusted esbuild binary did not produce the expected output");
}

process.stdout.write(`Verified trusted esbuild ${version} execution.\n`);
