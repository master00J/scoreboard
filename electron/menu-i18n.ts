export type MenuLocale = "nl" | "en" | "fr";

type MenuDict = Record<string, string>;

const MENUS: Record<MenuLocale, MenuDict> = {
  nl: {
    file: "Bestand",
    view: "Weergave",
    help: "Help",
    quit: "Afsluiten",
    quitConfirmTitle: "Stadium Scoreboard afsluiten?",
    quitConfirmMessage:
      "Wil je de applicatie echt afsluiten? Een lopende wedstrijd blijft in de database staan; sluit hem bij voorkeur eerst af via «Stop wedstrijd».",
    quitConfirmCancel: "Annuleren",
    quitConfirmOk: "Afsluiten",
    exportVenueBackup: "Exporteer venue-backup (ZIP)…",
    hideDisplay: "Verberg display-venster",
    showDisplay: "Toon display-venster",
    toggleFullscreen: "Display fullscreen aan/uit",
    openLogs: "Open log-map (foutopsporing)",
    openUploads: "Open uploads-map",
    reload: "Herladen (actief venster)",
    reloadControl: "Herlaad bedieningspaneel",
    reloadDisplay: "Herlaad stadionbeeld",
    devtoolsControl: "DevTools (control)",
    devtoolsDisplay: "DevTools (display)",
    licenses: "Licenties en open source…",
    backupTitle: "Venue-backup",
    backupFailed: "Exporteren mislukt.",
    backupSaved: "Backup opgeslagen.",
    unknownError: "Onbekende fout",
  },
  en: {
    file: "File",
    view: "View",
    help: "Help",
    quit: "Quit",
    quitConfirmTitle: "Quit Stadium Scoreboard?",
    quitConfirmMessage:
      "Do you really want to quit? An active match stays in the database; preferably stop it first via «Stop match».",
    quitConfirmCancel: "Cancel",
    quitConfirmOk: "Quit",
    exportVenueBackup: "Export venue backup (ZIP)…",
    hideDisplay: "Hide display window",
    showDisplay: "Show display window",
    toggleFullscreen: "Toggle display fullscreen",
    openLogs: "Open log folder (troubleshooting)",
    openUploads: "Open uploads folder",
    reload: "Reload (active window)",
    reloadControl: "Reload control panel",
    reloadDisplay: "Reload stadium display",
    devtoolsControl: "DevTools (control)",
    devtoolsDisplay: "DevTools (display)",
    licenses: "Licenses and open source…",
    backupTitle: "Venue backup",
    backupFailed: "Export failed.",
    backupSaved: "Backup saved.",
    unknownError: "Unknown error",
  },
  fr: {
    file: "Fichier",
    view: "Affichage",
    help: "Aide",
    quit: "Quitter",
    quitConfirmTitle: "Quitter Stadium Scoreboard ?",
    quitConfirmMessage:
      "Voulez-vous vraiment quitter ? Un match en cours reste en base ; arrêtez-le de préférence via « Arrêter le match ».",
    quitConfirmCancel: "Annuler",
    quitConfirmOk: "Quitter",
    exportVenueBackup: "Exporter sauvegarde venue (ZIP)…",
    hideDisplay: "Masquer la fenêtre d’affichage",
    showDisplay: "Afficher la fenêtre d’affichage",
    toggleFullscreen: "Plein écran affichage on/off",
    openLogs: "Ouvrir le dossier des logs",
    openUploads: "Ouvrir le dossier uploads",
    reload: "Recharger (fenêtre active)",
    reloadControl: "Recharger le panneau de contrôle",
    reloadDisplay: "Recharger l’affichage stade",
    devtoolsControl: "DevTools (contrôle)",
    devtoolsDisplay: "DevTools (affichage)",
    licenses: "Licences et open source…",
    backupTitle: "Sauvegarde venue",
    backupFailed: "Échec de l’export.",
    backupSaved: "Sauvegarde enregistrée.",
    unknownError: "Erreur inconnue",
  },
};

export function normalizeMenuLocale(raw: unknown): MenuLocale {
  return raw === "en" || raw === "fr" ? raw : "nl";
}

export function menuLabel(locale: MenuLocale, key: keyof (typeof MENUS)["nl"]): string {
  return MENUS[locale][key] ?? MENUS.nl[key] ?? key;
}
