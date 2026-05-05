import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ArenaCue",
    short_name: "ArenaCue",
    description:
      "ArenaCue — scoreboard, LED boarding en display control voor clubs en stadions (Windows).",
    lang: "nl-BE",
    dir: "ltr",
    start_url: "/",
    display: "standalone",
    categories: ["sports", "business"],
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
