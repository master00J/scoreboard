import { describe, expect, it } from "vitest";
import {
  FEATURE_REQUEST_MAX_CHARS,
  FEATURE_REQUEST_MAX_PHOTO_DATA_CHARS,
  FEATURE_REQUEST_MAX_PHOTOS,
  featureRequestResultFromResponse,
  normalizeFeatureRequestInput,
  normalizeFeatureRequestPhoto,
  sanitizeFeatureRequestPhotoName,
} from "./feature-request";

/** 1×1 PNG, geldige data-URL voor de tests. */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAA=";

describe("normalizeFeatureRequestInput", () => {
  it("trimt de tekst en laat lege optionele velden weg", () => {
    expect(normalizeFeatureRequestInput({ text: "  Toon de teamfouten naast de score.  ", contactEmail: " " })).toEqual({
      text: "Toon de teamfouten naast de score.",
    });
  });

  it("normaliseert e-mail en regionale taalcodes", () => {
    expect(
      normalizeFeatureRequestInput({
        text: "Toon de teamfouten naast de score.",
        contactEmail: " Club@Example.COM ",
        locale: "nl-BE",
      }),
    ).toEqual({ text: "Toon de teamfouten naast de score.", contactEmail: "club@example.com", locale: "nl" });
  });

  it("laat een onbekende taal weg in plaats van de aanvraag te weigeren", () => {
    expect(normalizeFeatureRequestInput({ text: "Toon de teamfouten naast de score.", locale: "de" })).toEqual({
      text: "Toon de teamfouten naast de score.",
    });
  });

  it("weigert te korte of te lange tekst, een ongeldig e-mailadres en niet-objecten", () => {
    expect(normalizeFeatureRequestInput({ text: "te kort" })).toBeNull();
    expect(normalizeFeatureRequestInput({ text: "x".repeat(FEATURE_REQUEST_MAX_CHARS + 1) })).toBeNull();
    expect(normalizeFeatureRequestInput({ text: "Toon de teamfouten naast de score.", contactEmail: "geen-mail" })).toBeNull();
    expect(normalizeFeatureRequestInput({ text: 12345678901 })).toBeNull();
    expect(normalizeFeatureRequestInput(null)).toBeNull();
    expect(normalizeFeatureRequestInput("Toon de teamfouten naast de score.")).toBeNull();
  });

  it("neemt geldige foto's mee en laat een lege lijst weg", () => {
    expect(
      normalizeFeatureRequestInput({
        text: "Toon de teamfouten naast de score.",
        photos: [{ name: "score.png", mimeType: "image/png", dataUrl: TINY_PNG }],
      }),
    ).toEqual({
      text: "Toon de teamfouten naast de score.",
      photos: [{ name: "score.png", mimeType: "image/png", dataUrl: TINY_PNG }],
    });
    expect(normalizeFeatureRequestInput({ text: "Toon de teamfouten naast de score.", photos: [] })).toEqual({
      text: "Toon de teamfouten naast de score.",
    });
  });

  it("weigert te veel, te grote of ongeldige foto's", () => {
    const photo = { name: "score.png", mimeType: "image/png", dataUrl: TINY_PNG };
    expect(
      normalizeFeatureRequestInput({
        text: "Toon de teamfouten naast de score.",
        photos: Array.from({ length: FEATURE_REQUEST_MAX_PHOTOS + 1 }, () => photo),
      }),
    ).toBeNull();
    expect(
      normalizeFeatureRequestInput({
        text: "Toon de teamfouten naast de score.",
        photos: [{ name: "x.png", mimeType: "image/png", dataUrl: "niet-een-data-url" }],
      }),
    ).toBeNull();
    expect(
      normalizeFeatureRequestInput({
        text: "Toon de teamfouten naast de score.",
        photos: [{ name: "x.png", mimeType: "image/gif", dataUrl: TINY_PNG }],
      }),
    ).toBeNull();
  });
});

describe("normalizeFeatureRequestPhoto", () => {
  it("leest mime uit de data-URL en ruimt de bestandsnaam op", () => {
    expect(normalizeFeatureRequestPhoto({ name: "../C:\\\\score?.png", dataUrl: TINY_PNG })).toEqual({
      name: "score.png",
      mimeType: "image/png",
      dataUrl: TINY_PNG,
    });
  });

  it("weigert een te korte, te lange of niet-beeld data-URL", () => {
    expect(normalizeFeatureRequestPhoto({ dataUrl: "data:image/png;base64,abc" })).toBeNull();
    expect(
      normalizeFeatureRequestPhoto({
        dataUrl: `data:image/png;base64,${"A".repeat(FEATURE_REQUEST_MAX_PHOTO_DATA_CHARS)}`,
      }),
    ).toBeNull();
    expect(normalizeFeatureRequestPhoto({ dataUrl: "data:text/plain;base64,AAAA" })).toBeNull();
    expect(normalizeFeatureRequestPhoto({ dataUrl: TINY_JPEG.replace("jpeg", "gif") })).toBeNull();
  });
});

describe("sanitizeFeatureRequestPhotoName", () => {
  it("kapt af en valt terug op een default", () => {
    expect(sanitizeFeatureRequestPhotoName("   ", "image/jpeg")).toBe("photo.jpg");
    expect(sanitizeFeatureRequestPhotoName("x".repeat(120) + ".png", "image/png").length).toBe(80);
  });
});

describe("featureRequestResultFromResponse", () => {
  it("is alleen geslaagd bij 2xx mét ok:true", () => {
    expect(featureRequestResultFromResponse(200, { ok: true })).toEqual({ ok: true, outcome: "accepted" });
    expect(featureRequestResultFromResponse(200, { ok: true, outcome: "accepted" })).toEqual({ ok: true, outcome: "accepted" });
    expect(
      featureRequestResultFromResponse(200, {
        ok: true,
        outcome: "exists",
        title: " Shotclock ",
        where: "Wedstrijd live",
        summary: "De shotclock kan standaard uit.",
      }),
    ).toEqual({
      ok: true,
      outcome: "exists",
      title: "Shotclock",
      where: "Wedstrijd live",
      summary: "De shotclock kan standaard uit.",
    });
    expect(featureRequestResultFromResponse(200, { ok: true, outcome: "exists", title: "Shotclock" })).toEqual({
      ok: true,
      outcome: "accepted",
    });
    expect(featureRequestResultFromResponse(200, {})).toEqual({ ok: false, reason: "server" });
    expect(featureRequestResultFromResponse(200, "<html>")).toEqual({ ok: false, reason: "server" });
  });

  it("neemt de reden van de site over", () => {
    expect(featureRequestResultFromResponse(403, { ok: false, reason: "license" })).toEqual({ ok: false, reason: "license" });
    expect(featureRequestResultFromResponse(429, { ok: false, reason: "rate_limited" })).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(featureRequestResultFromResponse(422, { ok: false, reason: "invalid" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("valt terug op de statuscode als de site geen (bekende) reden geeft", () => {
    expect(featureRequestResultFromResponse(429, {})).toEqual({ ok: false, reason: "rate_limited" });
    expect(featureRequestResultFromResponse(422, { reason: "iets-nieuws" })).toEqual({ ok: false, reason: "invalid" });
    expect(featureRequestResultFromResponse(403, null)).toEqual({ ok: false, reason: "license" });
    expect(featureRequestResultFromResponse(503, { ok: false, reason: "server" })).toEqual({ ok: false, reason: "server" });
    expect(featureRequestResultFromResponse(404, {})).toEqual({ ok: false, reason: "server" });
  });
});
