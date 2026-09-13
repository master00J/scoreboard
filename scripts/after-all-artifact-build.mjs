import { signFileWithAzure } from "./azure-trusted-sign.mjs";
import { azureSigningReady } from "./load-signing-env.mjs";

/** Sign portable + NSIS installer after electron-builder writes them. */
export default async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== "win32" || !azureSigningReady()) return;
  const exes = (buildResult.artifactPaths ?? []).filter((p) => p.toLowerCase().endsWith(".exe"));
  for (const file of exes) {
    await signFileWithAzure(file);
  }
}
