import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

/*
  Inter for the interface, JetBrains Mono for numbers and the small capitals
  that label them — the pairing the design system specifies. next/font serves
  both from our own origin, so no visitor's browser ever asks Google for them.
*/
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jetbrains-mono",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: t("name"), template: `%s · ${t("name")}` },
    description: t("tagline"),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f17" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Resolved per request from the locale cookie, then Accept-Language.
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
        <ThemeProvider>
          {/*
            Radix tooltips need a provider above every Tooltip. SidebarMenuButton
            renders one whenever it is given a `tooltip` prop — which the nav does
            for each item, so the collapsed sidebar can label its icons — and this
            shadcn build no longer bundles a provider inside SidebarProvider.
            Mounting it once at the root covers every tooltip in the app.
          */}
          <TooltipProvider>
            {children}
            <Toaster richColors closeButton position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
