import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const rendererDir = path.join(root, "renderer");
const outDir = path.join(root, "renderer-dist");
const assetsDir = path.join(outDir, "assets");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

async function main() {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });

  await run("npx", [
    "tailwindcss",
    "-i",
    "app/globals.css",
    "-o",
    "renderer-dist/assets/renderer.css",
    "--minify",
  ]);

  await esbuild.build({
    entryPoints: [path.join(rendererDir, "main.tsx")],
    outfile: path.join(assetsDir, "renderer.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    alias: {
      "@": root,
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
    },
  });

  await fs.copyFile(
    path.join(rendererDir, "index.html"),
    path.join(outDir, "index.html"),
  );
}

main().catch((err) => {
  console.error("[build-renderer]", err);
  process.exit(1);
});
