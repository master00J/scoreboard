"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Lightbulb } from "lucide-react";
import { isElectron } from "@/lib/electron";
import {
  FEATURE_REQUEST_MAX_CHARS,
  FEATURE_REQUEST_MIN_CHARS,
  type FeatureRequestFailure,
} from "@/lib/feature-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ERROR_KEYS: Record<FeatureRequestFailure, string> = {
  invalid: "featureRequest.errorInvalid",
  license: "featureRequest.errorLicense",
  rate_limited: "featureRequest.errorRateLimited",
  network: "featureRequest.errorNetwork",
  server: "featureRequest.errorServer",
};

/** Knop in de kopbalk: de club beschrijft een gewenste feature en stuurt die naar ArenaCue. */
export function FeatureRequestButton() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isElectron || typeof window === "undefined" || !window.electronAPI?.submitFeatureRequest) {
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const submit = window.electronAPI?.submitFeatureRequest;
    if (!submit) return;
    if (text.trim().length < FEATURE_REQUEST_MIN_CHARS) {
      setError(t("featureRequest.tooShort", { min: FEATURE_REQUEST_MIN_CHARS }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await submit({ text, contactEmail: email, locale: i18n.language });
      if (!result.ok) {
        setError(t(ERROR_KEYS[result.reason]));
        return;
      }
      setText("");
      setOpen(false);
      toast({
        title: t("featureRequest.sentTitle"),
        description: t("featureRequest.sentBody"),
        variant: "success",
      });
    } catch {
      setError(t("featureRequest.errorServer"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-8 gap-2"
        title={t("featureRequest.button")}
        aria-label={t("featureRequest.button")}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Lightbulb className="size-4" />
        <span className="hidden xl:inline">{t("featureRequest.button")}</span>
      </Button>

      {/* Buiten de kopbalk renderen: die heeft backdrop-blur, waardoor een fixed overlay erin vast zou zitten. */}
      {createPortal(
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!busy) setOpen(next);
          }}
        >
          <DialogContent size="md">
            <form onSubmit={(e) => void onSubmit(e)}>
              <DialogHeader>
                <DialogTitle>{t("featureRequest.title")}</DialogTitle>
                <DialogDescription>{t("featureRequest.description")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">{t("featureRequest.textLabel")}</span>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t("featureRequest.textPlaceholder")}
                    maxLength={FEATURE_REQUEST_MAX_CHARS}
                    rows={6}
                    disabled={busy}
                    autoFocus
                    className="flex min-h-[140px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className="block text-right text-xs text-muted-foreground tabular-nums">
                    {text.length} / {FEATURE_REQUEST_MAX_CHARS}
                  </span>
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">{t("featureRequest.emailLabel")}</span>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    disabled={busy}
                  />
                </label>
                {error && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? t("featureRequest.sending") : t("featureRequest.send")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>,
        document.body,
      )}
    </>
  );
}
