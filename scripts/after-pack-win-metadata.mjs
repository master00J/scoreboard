import path from "node:path";
import { rcedit } from "rcedit";
import { signFileWithAzure } from "./azure-trusted-sign.mjs";

/**
 * Zet CompanyName / copyright / icon op de Windows .exe zonder winCodeSign
 * (signAndEditExecutable blijft false i.v.m. symlink-rechten op Windows).
 * Azure Artifact Signing gebeurt hierna, als credentials aanwezig zijn.
 */
/** Alleen het cijferdeel, aangevuld tot a.b.c.d zoals de Windows-versiebron verwacht. */
function numericFileVersion(version) {
  const parts = String(version)
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).join(".");
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const productFilename = context.packager.appInfo.productFilename;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const version = context.packager.appInfo.version;
  const iconPath = path.join(context.packager.projectDir, "build", "icon.ico");

  await rcedit(exePath, {
    icon: iconPath,
    // Windows wil hier alleen cijfers. Een staging-build heet 0.1.54-staging.7, en dat zou
    // rcedit laten struikelen; het volledige nummer blijft in product-version staan.
    "file-version": numericFileVersion(version),
    "product-version": version,
    "version-string": {
      CompanyName: "ArenaCue",
      FileDescription: "Stadium Scoreboard",
      ProductName: "Stadium Scoreboard",
      LegalCopyright: "Copyright (c) Sound & Vision",
      OriginalFilename: `${productFilename}.exe`,
      InternalName: productFilename,
    },
  });

  console.log(`[afterPack] Windows-metadata gezet (uitgever: ArenaCue): ${exePath}`);
  await signFileWithAzure(exePath);
}
