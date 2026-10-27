import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NAUDIO_DLL,
  NAUDIO_RESOURCE_DIR,
  WASAPI_LOOPBACK_SOURCE,
  naudioHelperCandidates,
} from "./naudio-helper";
import { parseWasapiHelperError, wasapiHelperError } from "./livestream";

const repoRoot = path.resolve(__dirname, "..");

describe("GoXLR- en systeemgeluid in de gebouwde app", () => {
  it("zoekt eerst in de resources van de geïnstalleerde app, dan in het project", () => {
    const files = naudioHelperCandidates({
      resourcesPath: path.join("C:", "App", "resources"),
      appRoot: path.join("C:", "repo"),
      cwd: path.join("C:", "repo"),
    });
    expect(files.dll).toEqual([
      path.join("C:", "App", "resources", NAUDIO_RESOURCE_DIR, NAUDIO_DLL),
      path.join("C:", "repo", "vendor", "naudio", NAUDIO_DLL),
    ]);
    expect(files.source[0]).toBe(path.join("C:", "App", "resources", NAUDIO_RESOURCE_DIR, WASAPI_LOOPBACK_SOURCE));
    expect(files.source[1]).toBe(path.join("C:", "repo", "electron", WASAPI_LOOPBACK_SOURCE));
  });

  it("zet NAudio en de bron van de helper mee in het pakket", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      build: { extraResources: Array<{ from: string; to: string; filter?: string[] }> };
    };
    const resources = pkg.build.extraResources;
    const naudio = resources.find((item) => item.to === NAUDIO_RESOURCE_DIR);
    expect(naudio?.from).toBe("vendor/naudio");
    expect(naudio?.filter).toContain(NAUDIO_DLL);
    const source = resources.find((item) => item.to === `${NAUDIO_RESOURCE_DIR}/${WASAPI_LOOPBACK_SOURCE}`);
    expect(source?.from).toBe(`electron/${WASAPI_LOOPBACK_SOURCE}`);
    for (const file of [path.join("vendor", "naudio", NAUDIO_DLL), path.join("electron", WASAPI_LOOPBACK_SOURCE)]) {
      expect(fs.existsSync(path.join(repoRoot, file))).toBe(true);
    }
  });

  it("geeft de kanalen mee in de startfout, zodat de bediening ze kan tonen", () => {
    const error = wasapiHelperError(["Music (TC-Helicon GoXLR)", "System (TC-Helicon GoXLR)"]);
    expect(parseWasapiHelperError(error)).toEqual(["Music (TC-Helicon GoXLR)", "System (TC-Helicon GoXLR)"]);
    expect(parseWasapiHelperError("FFmpeg kon de stream niet starten")).toBeNull();
    expect(parseWasapiHelperError(null)).toBeNull();
    expect(parseWasapiHelperError("wasapi-helper:kapot")).toEqual([]);
  });
});
