import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ArenaCue",
    short_name: "ArenaCue",
    description: "Stadium Scoreboard & Display Control",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    icons: [
      {
        src: "/assets/arenacue-icon.png",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  };
}
