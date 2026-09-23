import type { TFunction } from "i18next";
import { tSportLabel } from "./t-sport";

export type CommandErrorPayload = {
  message: string;
  code?: string;
  params?: Record<string, string | number>;
};

export function translateCommandError(t: TFunction, payload: CommandErrorPayload): string {
  if (!payload.code) return payload.message;
  const params: Record<string, string | number> = { ...payload.params };
  if (typeof params.sport === "string") {
    params.sport = tSportLabel(t, params.sport);
  }
  const key = `commandErrors.${payload.code}`;
  const translated = t(key, params);
  return translated === key ? payload.message : translated;
}
