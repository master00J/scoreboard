import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const RESERVED = new Set(
  [
    "api",
    "_next",
    "static",
    "licentie",
    "portal",
    "changelog",
    "functies",
    "privacy",
    "terms",
    "manifest.webmanifest",
    "robots.txt",
    "sitemap.xml",
    "favicon.ico",
  ].map((s) => s.toLowerCase()),
);

function normalizeAdminPath(raw) {
  const s = (raw ?? "admin").trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "");
  if (!s) {
    return "admin";
  }
  if (!/^[a-zA-Z0-9_-]{2,80}$/.test(s)) {
    return "admin";
  }
  if (RESERVED.has(s.toLowerCase())) {
    return "admin";
  }
  return s;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: projectRoot,
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  async rewrites() {
    const seg = normalizeAdminPath(process.env.NEXT_PUBLIC_ADMIN_PATH);
    if (seg === "admin") {
      return [];
    }
    return [
      { source: `/${seg}`, destination: "/admin" },
      { source: `/${seg}/:path*`, destination: "/admin/:path*" },
    ];
  },
};

export default nextConfig;
