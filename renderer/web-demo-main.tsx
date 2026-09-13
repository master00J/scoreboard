import { DEFAULT_LOCALE, ensureI18n } from "@/lib/i18n";
import { uiLocaleFromSearch } from "@/lib/i18n/locales";
import { installWebDemoBridge } from "./web-bridge";

installWebDemoBridge();
ensureI18n(uiLocaleFromSearch(window.location.search) ?? DEFAULT_LOCALE);

void import("./main");
