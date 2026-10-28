import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "react-hot-toast";
import { dmSans, syne } from "./fonts";
import FirebaseAnalytics from "./components/FirebaseAnalytics";

export { metadata } from "./metadata";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${syne.variable} font-body antialiased`}>
        <div className="SP-shell">
          <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-8 pt-5 sm:px-6">
            {children}
          </div>
        </div>
        <FirebaseAnalytics />
        <Toaster position="top-center" toastOptions={{ duration: 2800 }} />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
