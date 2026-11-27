/**
 * Welke kaart het stadionscherm toont. Krijgt een speler die al geel had in deze wedstrijd een tweede gele
 * of een rode kaart, dan is dat een tweede gele kaart: het scherm toont dan geel en rood samen
 * ("YELLOW_RED"). Het wedstrijdverslag houdt de kaart zoals ze gegeven is.
 */
export type ShownCardColor = "YELLOW" | "RED" | "GREEN" | "YELLOW_RED";

export function shownCardColor(color: "YELLOW" | "RED" | "GREEN", earlierYellowCards: number): ShownCardColor {
  if ((color === "YELLOW" || color === "RED") && earlierYellowCards > 0) return "YELLOW_RED";
  return color;
}
