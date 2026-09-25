import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "Roopkala Lead Desk", template: "%s · Roopkala Lead Desk" },
  description: "Fast, accountable lead response for every enquiry.",
  applicationName: "Roopkala Lead Desk",
  icons: { icon: "/favicon.ico" },
  openGraph: {
    title: "Roopkala Lead Desk",
    description: "Fast response. Clear evidence.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Roopkala Lead Desk response dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Roopkala Lead Desk",
    description: "Fast response. Clear evidence.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = { themeColor: "#ffffff", colorScheme: "light", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={inter.variable} suppressHydrationWarning>{children}</body></html>;
}
