import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Studio",
  description:
    "A browser-based, local-first video editor. Edit, arrange and export video entirely on your computer — no account, no cloud, no uploads.",
  robots: { index: false, follow: false }, // not a public indexable product yet
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0d0f",
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className="h-full">
      {/*
       * Skip-to-main link for keyboard users.
       * Visually hidden until focused; targets #main-content in AppShell.
       */}
      <body className="h-full bg-cs-bg-base text-cs-text-primary antialiased">
        <a
          href="#main-content"
          className={[
            "sr-only focus:not-sr-only",
            "fixed top-2 left-2 z-50",
            "px-3 py-1.5 text-xs font-medium rounded",
            "bg-cs-accent text-white",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-white",
          ].join(" ")}
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
