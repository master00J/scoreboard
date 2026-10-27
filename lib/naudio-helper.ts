import path from "node:path";

/** Map naast ffmpeg in de geïnstalleerde app (`extraResources` in package.json). */
export const NAUDIO_RESOURCE_DIR = "naudio";
export const NAUDIO_DLL = "NAudio.dll";
export const WASAPI_LOOPBACK_SOURCE = "wasapi-loopback-capture.cs";

/**
 * Waar de bestanden voor GoXLR- en systeemgeluid staan, in volgorde van voorkeur. De geïnstalleerde
 * app heeft ze in `resources/naudio`; tijdens ontwikkeling staan ze in het project. Zonder de
 * resources-map kon een gebouwde versie dat geluid nooit opnemen.
 */
export function naudioHelperCandidates(opts: {
  resourcesPath: string;
  appRoot: string;
  cwd: string;
}): { dll: string[]; source: string[] } {
  const roots = [...new Set([opts.appRoot, opts.cwd])];
  return {
    dll: [
      path.join(opts.resourcesPath, NAUDIO_RESOURCE_DIR, NAUDIO_DLL),
      ...roots.map((root) => path.join(root, "vendor", "naudio", NAUDIO_DLL)),
    ],
    source: [
      path.join(opts.resourcesPath, NAUDIO_RESOURCE_DIR, WASAPI_LOOPBACK_SOURCE),
      ...roots.map((root) => path.join(root, "electron", WASAPI_LOOPBACK_SOURCE)),
    ],
  };
}
