import { z } from "zod";

const licenseKeySchema = z
  .string()
  .trim()
  .min(8, "Ongeldige licentiesleutel.")
  .max(64, "Ongeldige licentiesleutel.")
  .regex(/^[A-Za-z0-9._-]+$/, "Ongeldige licentiesleutel.");

const machineIdSchema = z
  .string()
  .trim()
  .min(8, "Ongeldige machine-id.")
  .max(256, "Ongeldige machine-id.");

export const licenseCheckBodySchema = z.object({
  licenseKey: licenseKeySchema,
  machineId: machineIdSchema,
});

export const licenseActivateBodySchema = z.object({
  licenseKey: licenseKeySchema,
  machineId: machineIdSchema,
  deviceLabel: z.string().trim().max(120).optional(),
});

export const licensePortalBodySchema = z.object({
  licenseKey: licenseKeySchema,
  ownerEmail: z.string().trim().toLowerCase().email(),
});

export type LicensePortalBody = z.infer<typeof licensePortalBodySchema>;

export function normalizeLicenseKey(key: string): string {
  return key.trim().toUpperCase();
}
