import { DM_Sans, Syne } from "next/font/google";

export const syne = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

/** Back-compat aliases for layout imports. */
export const fraunces = syne;
export const outfit = dmSans;
