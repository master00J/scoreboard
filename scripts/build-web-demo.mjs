import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "..", "Arenacue", "public", "scoreboard-app");
const assetsDir = path.join(outDir, "assets");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: true });
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

  const cssTmp = path.join(root, "web-demo-css");
  await fs.mkdir(cssTmp, { recursive: true });
  await run("npx", [
    "tailwindcss",
    "-i",
    "app/globals.css",
    "-o",
    "web-demo-css/renderer.css",
    "--minify",
  ]);
  await fs.copyFile(path.join(cssTmp, "renderer.css"), path.join(assetsDir, "renderer.css"));
  await fs.rm(cssTmp, { recursive: true, force: true });

  await esbuild.build({
    entryPoints: [path.join(root, "renderer", "web-demo-main.tsx")],
    outfile: path.join(assetsDir, "renderer.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    alias: { "@": root },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  await fs.writeFile(
    path.join(outDir, "index.html"),
    `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ArenaCue Scoreboard</title>
    <link rel="stylesheet" href="./assets/renderer.css" />
    <script>
      (function () {
        var m = /(?:^|[?&])(?:lang|locale)=([a-z]{2})/.exec(location.search);
        if (m) document.documentElement.lang = m[1];
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/renderer.js?v=locale"></script>
  </body>
</html>
`,
  );
}

main().catch((err) => {
  console.error("[build-web-demo]", err);
  process.exit(1);
});
