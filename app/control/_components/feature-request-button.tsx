"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ImagePlus, Lightbulb, X } from "lucide-react";
import { isElectron } from "@/lib/electron";
import {
  FEATURE_REQUEST_MAX_CHARS,
  FEATURE_REQUEST_MAX_PHOTO_DATA_CHARS,
  FEATURE_REQUEST_MAX_PHOTOS,
  FEATURE_REQUEST_MIN_CHARS,
  type FeatureReply,
  type FeatureRequestFailure,
  type FeatureRequestPhoto,
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

const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
const PHOTO_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const PHOTO_MAX_EDGE = 1280;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = src;
  });
}

async function photoFromFile(
  file: File,
): Promise<{ ok: true; photo: FeatureRequestPhoto } | { ok: false; reason: "type" | "size" | "read" }> {
  const typeOk = file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp";
  const extOk = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!typeOk && !extOk) return { ok: false, reason: "type" };
  if (file.size > PHOTO_MAX_SOURCE_BYTES) return { ok: false, reason: "size" };

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) return { ok: false, reason: "read" };
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(srcW, srcH));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(srcW * scale));
    canvas.height = Math.max(1, Math.round(srcH * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "read" };
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > FEATURE_REQUEST_MAX_PHOTO_DATA_CHARS && quality > 0.45) {
      quality -= 0.12;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > FEATURE_REQUEST_MAX_PHOTO_DATA_CHARS) return { ok: false, reason: "size" };
    const leaf = file.name.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") || "photo";
    const name = `${leaf}.jpg`.slice(0, 80);
    return { ok: true, photo: { name, mimeType: "image/jpeg", dataUrl } };
  } catch {
    return { ok: false, reason: "read" };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

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
  const [reply, setReply] = useState<FeatureReply | null>(null);
  const [photos, setPhotos] = useState<FeatureRequestPhoto[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

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
      const result = await submit({
        text,
        contactEmail: email,
        locale: i18n.language,
        ...(photos.length ? { photos } : {}),
      });
      if (!result.ok) {
        setError(t(ERROR_KEYS[result.reason]));
        return;
      }
      if (result.outcome !== "accepted") {
        setReply(result);
        return;
      }
      setText("");
      setPhotos([]);
      setReply(null);
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

  async function onPhotosSelected(files: FileList | null) {
    if (!files?.length) return;
    const remaining = FEATURE_REQUEST_MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      setError(t("featureRequest.photosTooMany", { max: FEATURE_REQUEST_MAX_PHOTOS }));
      return;
    }
    const picked = Array.from(files).slice(0, remaining);
    if (files.length > remaining) {
      setError(t("featureRequest.photosTooMany", { max: FEATURE_REQUEST_MAX_PHOTOS }));
    } else {
      setError(null);
    }
    const added: FeatureRequestPhoto[] = [];
    for (const file of picked) {
      const result = await photoFromFile(file);
      if (!result.ok) {
        setError(
          t(
            result.reason === "type"
              ? "featureRequest.photosInvalidType"
              : result.reason === "size"
                ? "featureRequest.photosTooLarge"
                : "featureRequest.photosReadFailed",
          ),
        );
        continue;
      }
      added.push(result.photo);
    }
    if (added.length) setPhotos((prev) => [...prev, ...added].slice(0, FEATURE_REQUEST_MAX_PHOTOS));
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
          setReply(null);
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
            {reply ? (
              <div className="space-y-4">
                <DialogHeader>
                  <DialogTitle>
                    {t(reply.outcome === "exists" ? "featureRequest.existsHeading" : "featureRequest.requestedHeading")}
                  </DialogTitle>
                  <DialogDescription>{reply.title}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <p>
                    <span className="font-medium">{t("featureRequest.whereLabel")}</span>
                    <span className="mt-1 block text-muted-foreground">{reply.where}</span>
                  </p>
                  <p className="leading-relaxed">{reply.summary}</p>
                </div>
                <DialogFooter>
                  <Button type="button" onClick={() => setOpen(false)}>
                    {t("featureRequest.close")}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
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
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{t("featureRequest.photosLabel")}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {photos.length} / {FEATURE_REQUEST_MAX_PHOTOS}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("featureRequest.photosHint", { max: FEATURE_REQUEST_MAX_PHOTOS })}
                  </p>
                  {photos.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {photos.map((photo, index) => (
                        <li key={`${photo.name}-${index}`} className="relative">
                          <img
                            src={photo.dataUrl}
                            alt={photo.name}
                            className="h-16 w-16 rounded-md border border-border object-cover"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border bg-background text-foreground shadow-sm disabled:opacity-50"
                            aria-label={t("featureRequest.photosRemove")}
                            onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== index))}
                          >
                            <X className="size-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <input
                    id="feature-request-photos"
                    ref={photoInputRef}
                    type="file"
                    accept={PHOTO_ACCEPT}
                    multiple
                    className="sr-only"
                    disabled={busy || photos.length >= FEATURE_REQUEST_MAX_PHOTOS}
                    onChange={(e) => {
                      const files = e.target.files;
                      e.target.value = "";
                      void onPhotosSelected(files);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={busy || photos.length >= FEATURE_REQUEST_MAX_PHOTOS}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <ImagePlus className="size-4" />
                    {t("featureRequest.photosAdd")}
                  </Button>
                </div>
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
                  {busy ? t("featureRequest.checking") : t("featureRequest.send")}
                </Button>
              </DialogFooter>
            </form>
            )}
          </DialogContent>
        </Dialog>,
        document.body,
      )}
    </>
  );
}
