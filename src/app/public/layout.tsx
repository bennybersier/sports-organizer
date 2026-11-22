import type { Metadata } from "next";

/**
 * The shell for share-link pages: no sidebar, no account, nothing that
 * suggests the visitor is inside the club's app.
 */
export const metadata: Metadata = {
  // The root layout already says noindex; stated again so a change there does
  // not quietly put children's fixtures in a search engine.
  robots: { index: false, follow: false },
  // The token is in the path. A parent tapping a map link must not hand it to
  // the map provider in a Referer header.
  referrer: "no-referrer",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">{children}</main>
    </div>
  );
}
