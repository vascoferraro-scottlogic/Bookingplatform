import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import Providers from "./providers";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Club Management Platform",
  description: "Multi-tenant bowling club booking platform",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#166534",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
          <PwaRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
