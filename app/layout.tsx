import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/shell/Providers";
import { Backdrop } from "@/components/shell/Backdrop";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "Hermes Battlestation",
  description:
    "Hermes Battlestation — cockpit for your local agent. Chat, repos, fleet, and review, over Tailscale.",
  applicationName: "Hermes Battlestation",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Battlestation",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  // Canonical Hermes Teal — matches the default theme + the manifest.
  themeColor: "#041c1c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

/**
 * Pre-mount theme boot. Runs synchronously before first paint (first child of
 * <body>) so a non-default stored theme paints its canvas + text immediately
 * with no flash of Hermes Teal. ThemeProvider applies the full theme on mount.
 * Keep the palette map in sync with lib/themes/presets.ts.
 */
const THEME_BOOT = `(function(){try{
var alias={"lens-5i":"nous-blue"};
var k=localStorage.getItem("hermes-dashboard-theme")||"default";k=alias[k]||k;
var P={
"default":["#041c1c","#ffe6cb","#ffffff",0],
"default-large":["#041c1c","#ffe6cb","#ffffff",0],
"nous-blue":["#170d02","#FFAC02","#FFFFFF",1],
"midnight":["#0a0a1f","#d4c8ff","#ffffff",0],
"ember":["#1a0a06","#ffd8b0","#ffffff",0],
"mono":["#0e0e0e","#eaeaea","#ffffff",0],
"cyberpunk":["#040608","#9bffcf","#ffffff",0],
"rose":["#1a0f15","#ffd4e1","#ffffff",0]};
var p=P[k]||P["default"];var r=document.documentElement,s=r.style;
s.setProperty("--background-base",p[0]);
s.setProperty("--background","color-mix(in srgb, "+p[0]+" 100%, transparent)");
s.setProperty("--midground-base",p[1]);
s.setProperty("--midground","color-mix(in srgb, "+p[1]+" 100%, transparent)");
s.setProperty("--foreground-base",p[2]);
s.setProperty("--foreground","color-mix(in srgb, "+p[2]+" "+(p[3]*100)+"%, transparent)");
s.setProperty("--foreground-alpha",String(p[3]));
}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <Providers>
          <Backdrop />
          {children}
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
