/**
 * Client-side helpers for the Electron wrapper.
 * Safe to import in browser context — all functions no-op when not in Electron.
 */

export const isElectron =
  typeof window !== "undefined" && window.electronAPI?.context.isElectron === true;

/** Open a native file-selection dialog. Returns the selected paths (empty if cancelled or not in Electron). */
export async function selectFilesViaDialog(opts: {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
  multiSelections?: boolean;
}): Promise<string[]> {
  if (!isElectron || !window.electronAPI) return [];
  const result = await window.electronAPI.selectFile(opts);
  return result.canceled ? [] : result.filePaths;
}

/** Open a native folder-selection dialog and list the contents (optionally filtered by extension). */
export async function selectFolderViaDialog(opts: {
  title?: string;
  extensions?: string[];
}): Promise<{ folderPath: string | null; files: Array<{ name: string; path: string }> }> {
  if (!isElectron || !window.electronAPI) {
    return { folderPath: null, files: [] };
  }
  const result = await window.electronAPI.selectFolder(opts);
  if (result.canceled) return { folderPath: null, files: [] };
  return { folderPath: result.folderPath, files: result.files };
}

export function desktopViewUrl(
  view: "control" | "display",
  extraQuery?: Record<string, string | number | boolean | null | undefined>,
): string {
  if (typeof window === "undefined") return view === "display" ? "/display" : "/control";
  if (!isElectron) {
    const path = view === "display" ? "/display" : "/control";
    const url = new URL(path, window.location.origin);
    for (const [key, value] of Object.entries(extraQuery ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.pathname + url.search;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("view", view);
  for (const [key, value] of Object.entries(extraQuery ?? {})) {
    if (value === undefined || value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function focusDisplayWindow() {
  if (isElectron && window.electronAPI) {
    await window.electronAPI.focusDisplayWindow();
    return;
  }
  if (typeof window !== "undefined") {
    window.open("/display", "_blank", "noopener,noreferrer");
  }
}

export async function exportMatch(
  matchId: string,
  format: "json" | "html",
): Promise<void> {
  if (isElectron && window.electronAPI) {
    await window.electronAPI.exportMatch({ matchId, format });
    return;
  }
  if (typeof window !== "undefined") {
    const href = `/api/matches/${matchId}/export?format=${format}`;
    if (format === "html") {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    a.click();
  }
}
