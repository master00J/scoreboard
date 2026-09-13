import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { azureSigningConfig, azureSigningReady } from "./load-signing-env.mjs";

const execFileAsync = promisify(execFile);

const TOOLS_ROOT = path.join(process.env.LOCALAPPDATA || process.env.TEMP, "ArenacueSigning");
const BUILD_TOOLS = {
  name: "Microsoft.Windows.SDK.BuildTools",
  version: "10.0.26100.4188",
  signtoolRel: path.join("bin", "10.0.26100.0", "x64", "signtool.exe"),
};
const SIGNING_CLIENT = {
  name: "Microsoft.Trusted.Signing.Client",
  version: "1.0.95",
  dlibRel: path.join("bin", "x64", "Azure.CodeSigning.Dlib.dll"),
};

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function runPowerShell(command, extraEnv = {}) {
  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...extraEnv },
    },
  );
  return `${stdout || ""}${stderr || ""}`.trim();
}

export async function isAuthenticodeSigned(filePath) {
  const out = await runPowerShell(`(Get-AuthenticodeSignature -FilePath ${psQuote(filePath)}).Status`);
  return out.split(/\r?\n/).pop()?.trim() === "Valid";
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function nugetNupkgUrl(name, version) {
  const id = name.toLowerCase();
  return `https://api.nuget.org/v3-flatcontainer/${id}/${version}/${id}.${version}.nupkg`;
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download mislukt (${res.status}): ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

async function extractNupkg(nupkgPath, destDir) {
  await mkdir(destDir, { recursive: true });
  await execFileAsync("tar", ["-xf", nupkgPath, "-C", destDir], { windowsHide: true });
}

async function ensureNugetPackage(pkg) {
  const destDir = path.join(TOOLS_ROOT, `${pkg.name}.${pkg.version}`);
  const marker = pkg.signtoolRel || pkg.dlibRel;
  const needed = path.join(destDir, marker);
  if (await fileExists(needed)) return destDir;

  await mkdir(TOOLS_ROOT, { recursive: true });
  const nupkgPath = path.join(TOOLS_ROOT, `${pkg.name}.${pkg.version}.nupkg`);
  if (!(await fileExists(nupkgPath))) {
    const url = nugetNupkgUrl(pkg.name, pkg.version);
    console.log(`[azure-sign] download ${pkg.name} ${pkg.version}`);
    await downloadFile(url, nupkgPath);
  }
  console.log(`[azure-sign] uitpakken ${pkg.name}`);
  await extractNupkg(nupkgPath, destDir);
  if (!(await fileExists(needed))) {
    throw new Error(`Pakket ${pkg.name} mist ${marker}`);
  }
  return destDir;
}

async function ensureSigningTools() {
  const [buildToolsDir, clientDir] = await Promise.all([
    ensureNugetPackage(BUILD_TOOLS),
    ensureNugetPackage(SIGNING_CLIENT),
  ]);
  return {
    signtool: path.join(buildToolsDir, BUILD_TOOLS.signtoolRel),
    dlib: path.join(clientDir, SIGNING_CLIENT.dlibRel),
  };
}

async function writeMetadata(config) {
  const metadataPath = path.join(TOOLS_ROOT, "metadata.json");
  await mkdir(TOOLS_ROOT, { recursive: true });
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        Endpoint: config.endpoint,
        CodeSigningAccountName: config.account,
        CertificateProfileName: config.profile,
      },
      null,
      2,
    ),
  );
  return metadataPath;
}

/** Sign one Windows binary with Azure Artifact / Trusted Signing. */
export async function signFileWithAzure(filePath) {
  if (process.platform !== "win32") {
    console.warn(`[azure-sign] overgeslagen (geen Windows): ${filePath}`);
    return false;
  }
  if (!azureSigningReady()) {
    console.log("[azure-sign] geen Azure-credentials — exe blijft unsigned");
    return false;
  }
  if (await isAuthenticodeSigned(filePath)) {
    console.log(`[azure-sign] al geldig ondertekend: ${filePath}`);
    return true;
  }

  const c = azureSigningConfig();
  const tools = await ensureSigningTools();
  const metadataPath = await writeMetadata(c);

  console.log(`[azure-sign] ondertekenen: ${filePath}`);
  try {
    const { stdout, stderr } = await execFileAsync(
      tools.signtool,
      [
        "sign",
        "/v",
        "/fd",
        "SHA256",
        "/tr",
        "http://timestamp.acs.microsoft.com",
        "/td",
        "SHA256",
        "/dlib",
        tools.dlib,
        "/dmdf",
        metadataPath,
        filePath,
      ],
      {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          AZURE_TENANT_ID: c.tenantId,
          AZURE_CLIENT_ID: c.clientId,
          AZURE_CLIENT_SECRET: c.clientSecret,
        },
      },
    );
    const log = `${stdout || ""}${stderr || ""}`.trim();
    if (log) console.log(log);
  } catch (error) {
    const details = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n");
    throw new Error(`Azure signing mislukt voor ${filePath}\n${details}`);
  }

  if (!(await isAuthenticodeSigned(filePath))) {
    throw new Error(`Azure signing gaf geen geldige Authenticode-handtekening: ${filePath}`);
  }
  console.log(`[azure-sign] ok: ${filePath}`);
  return true;
}
