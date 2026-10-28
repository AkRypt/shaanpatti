import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shaanpatti",
  description:
    "Wrong answers only — write the worst take, vote the best one, laugh when names drop.",
  applicationName: "Shaanpatti",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/shaanpatti-logo.png" }],
  },
  openGraph: {
    title: "Shaanpatti",
    description: "Wrong answers only. Anonymous board. Vote the best lie.",
    type: "website",
  },
};
