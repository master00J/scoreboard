import path from "node:path";
import { rcedit } from "rcedit";

/**
 * Zet CompanyName / copyright / icon op de Windows .exe zonder winCodeSign
 * (signAndEditExecutable blijft false i.v.m. symlink-rechten op Windows).
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const productFilename = context.packager.appInfo.productFilename;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const version = context.packager.appInfo.version;
  const iconPath = path.join(context.packager.projectDir, "build", "icon.ico");

  await rcedit(exePath, {
    icon: iconPath,
    "file-version": version,
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
}
