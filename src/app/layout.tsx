import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sport Club Organizer",
    template: "%s · Sport Club Organizer",
  },
  description:
    "Plan seasons, teams, trainers and gyms — and generate a training schedule your club can rely on.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="flex min-h-full flex-col">
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
      </body>
    </html>
  );
}
