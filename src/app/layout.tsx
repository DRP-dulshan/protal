import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { env } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${env.appName}`,
    template: `%s · D|R|P`,
  },
  description:
    "Property management, leasing and holiday homes operations for D|R|P, Dubai.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "D|R|P PMS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // lang/dir are set here so the Arabic pass only has to flip these two
  // attributes once a locale cookie exists.
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
