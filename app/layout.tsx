import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "./components/AppShell";
import { NetworkProvider } from "./lib/network-context";
import { ThemeProvider } from "./components/ThemeSwitcher";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Network Dashboard",
  description: "Real-time monitoring dashboard for Agent Network nodes via CommHub",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Agent Network",
  },
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: "Agent Network Dashboard",
    description: "Real-time monitoring dashboard for Agent Network nodes",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#0a0a1a",
};

// Inline pre-paint script to apply persisted theme before React hydrates,
// preventing a white flash on light/mint themes for users who already set it.
const themeBootScript = `
try {
  var t = localStorage.getItem('anet-theme') || 'cyber';
  document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="cyber" className={`${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
        <ThemeProvider>
          <NetworkProvider>
            <AppShell>{children}</AppShell>
          </NetworkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
