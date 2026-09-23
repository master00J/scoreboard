"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  CONTROL_TABS,
  FULL_PROFILE_ID,
  INTERFACE_PANELS,
  SIMPLE_PROFILE_ID,
  activeInterfaceProfile,
  blankInterfaceProfile,
  newInterfaceProfile,
  parseInterfaceProfileStore,
  type ControlTabId,
  type InterfaceProfile,
  type InterfaceProfileStore,
} from "@/lib/interface-profiles";
import type { MatchTabPanelId } from "@/lib/control-match-layout";

function profileLabel(t: (key: string) => string, profile: InterfaceProfile): string {
  if (profile.id === FULL_PROFILE_ID) return t("shell.profileFull");
  if (profile.id === SIMPLE_PROFILE_ID) return t("shell.profileMatch");
  return profile.name;
}

function tabKey(tab: ControlTabId): string {
  if (tab === "match") return "shell.tabMatch";
  if (tab === "setup") return "shell.tabSetup";
  if (tab === "media") return "shell.tabMedia";
  if (tab === "reports") return "shell.tabReports";
  return "shell.tabLivestream";
}

export function InterfaceProfileControl({
  raw,
  onSaved,
  onPreview,
}: {
  raw: string | null | undefined;
  onSaved: () => void;
  onPreview?: (profile: InterfaceProfile | null) => void;
}) {
  const { t } = useTranslation();
  const store = parseInterfaceProfileStore(raw);
  const active = activeInterfaceProfile(store);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<InterfaceProfile>(active);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!onPreview) return;
    onPreview(open && !editor.builtin ? editor : null);
  }, [open, editor, onPreview]);

  async function persist(next: InterfaceProfileStore) {
    setBusy(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interfaceProfilesJson: JSON.stringify(parseInterfaceProfileStore(JSON.stringify(next))) }),
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: t("shell.profileSaveFailed"), variant: "error" });
      return false;
    }
    onSaved();
    return true;
  }

  function openEditor(profile: InterfaceProfile) {
    setEditor({ ...profile, tabs: [...profile.tabs], panels: [...profile.panels] });
  }

  function toggleTab(tab: ControlTabId, on: boolean) {
    setEditor((current) => {
      const base = current.builtin ? newInterfaceProfile(current, t("shell.profileNewName")) : current;
      return {
        ...base,
        tabs: on ? [...base.tabs, tab] : base.tabs.filter((item) => item !== tab),
      };
    });
  }

  function togglePanel(panel: MatchTabPanelId, on: boolean) {
    setEditor((current) => {
      const base = current.builtin ? newInterfaceProfile(current, t("shell.profileNewName")) : current;
      return {
        ...base,
        panels: on ? [...base.panels, panel] : base.panels.filter((item) => item !== panel),
      };
    });
  }

  function readyToSave(): boolean {
    if (editor.builtin) return true;
    if (editor.tabs.length === 0) {
      toast({ title: t("shell.profileNeedTab"), variant: "error" });
      return false;
    }
    return true;
  }

  function storeWithEditor(base: InterfaceProfileStore): InterfaceProfileStore {
    if (editor.builtin) return base;
    const name = editor.name.trim() || t("shell.profileNewName");
    const nextEditor = { ...editor, name };
    const exists = base.profiles.some((profile) => profile.id === nextEditor.id);
    return {
      ...base,
      profiles: exists
        ? base.profiles.map((profile) => (profile.id === nextEditor.id ? nextEditor : profile))
        : [...base.profiles, nextEditor],
    };
  }

  return (
    <>
      <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/70 bg-card/70 px-2 text-xs font-semibold">
        <LayoutDashboard className="size-4 text-primary" />
        <span className="hidden lg:inline">{t("shell.profileLabel")}</span>
        <select
          aria-label={t("shell.profileLabel")}
          className="h-8 max-w-[11rem] rounded-md border border-border bg-zinc-950 px-2 text-xs font-semibold text-zinc-50 outline-none"
          style={{ colorScheme: "dark" }}
          value={active.id}
          onChange={(event) => void persist({ ...store, activeId: event.target.value })}
        >
          {store.profiles.map((profile) => (
            <option key={profile.id} value={profile.id} style={{ backgroundColor: "#09090b", color: "#fafafa" }}>
              {profileLabel(t, profile)}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-10"
        onClick={() => {
          openEditor(active);
          setOpen(true);
        }}
      >
        {t("shell.profileManage")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{t("shell.profileManage")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("shell.profileHelp")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {store.profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => openEditor(profile)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  profile.id === editor.id ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                {profileLabel(t, profile)}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("shell.profileTabs")}
              </legend>
              {CONTROL_TABS.map((tab) => (
                <label key={tab} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editor.tabs.includes(tab)}
                    disabled={busy}
                    onChange={(event) => toggleTab(tab, event.target.checked)}
                  />
                  {t(tabKey(tab))}
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("shell.profilePanels")}
              </legend>
              {INTERFACE_PANELS.map((panel) => (
                <label key={panel} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editor.panels.includes(panel)}
                    disabled={busy}
                    onChange={(event) => togglePanel(panel, event.target.checked)}
                  />
                  {t(`panels.${panel}`)}
                </label>
              ))}
            </fieldset>
          </div>
          {!editor.builtin && (
            <div className="mt-4">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("shell.profileName")}
              </label>
              <Input
                className="mt-1 max-w-xs"
                value={editor.name}
                maxLength={32}
                onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
          )}
          {editor.builtin && (
            <p className="mt-4 text-xs text-muted-foreground">{t("shell.profileBuiltinHint")}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => openEditor(blankInterfaceProfile(t("shell.profileNewName")))}
            >
              {t("shell.profileNew")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => openEditor(newInterfaceProfile(editor, t("shell.profileNewName")))}
            >
              {t("shell.profileDuplicate")}
            </Button>
            {!editor.builtin && store.profiles.some((profile) => profile.id === editor.id) && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const profiles = store.profiles.filter((profile) => profile.id !== editor.id);
                  openEditor(store.profiles.find((profile) => profile.id === FULL_PROFILE_ID) ?? store.profiles[0]!);
                  void persist({
                    activeId: store.activeId === editor.id ? FULL_PROFILE_ID : store.activeId,
                    profiles,
                  });
                }}
              >
                {t("shell.profileDelete")}
              </Button>
            )}
            {!editor.builtin && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  if (!readyToSave()) return;
                  void persist(storeWithEditor(store));
                }}
              >
                {t("shell.profileSave")}
              </Button>
            )}
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!readyToSave()) return;
                const next = storeWithEditor(store);
                void persist({ ...next, activeId: editor.id }).then((ok) => {
                  if (ok) setOpen(false);
                });
              }}
            >
              {t("shell.profileUse")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
