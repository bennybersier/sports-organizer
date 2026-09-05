import { getTranslations } from "next-intl/server";

/*
  This Suspense boundary makes navigation feel instant, at one cost worth
  knowing: the shell flushes before page data resolves, so a `notFound()` raised
  afterwards streams the not-found UI in but cannot change the already-committed
  HTTP status, which stays 200. Users see the correct page; crawlers would not.
  Acceptable here — the whole app is behind auth and marked noindex.
*/

import { Skeleton } from "@/components/ui/skeleton";

export default async function AppLoading() {
  const t = await getTranslations("common");

  return (
    <div className="flex w-full flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
