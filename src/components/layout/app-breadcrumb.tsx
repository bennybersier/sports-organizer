"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { NAVIGATION } from "@/domain/navigation";

const Crumb = createContext<{ title: string | null; set: (title: string | null) => void }>({
  title: null,
  set: () => {},
});

/**
 * Where you are, in the top bar: club, section, and — on a page about one
 * record — that record.
 *
 * The section comes from the path. The record's name does not: only the page
 * knows it, so a page names itself with `<PageCrumb>` and the bar picks it up
 * through this provider, which sits around both the bar and the page.
 */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [title, set] = useState<string | null>(null);
  return <Crumb.Provider value={{ title, set }}>{children}</Crumb.Provider>;
}

/** Puts this page's own name at the end of the breadcrumb. Renders nothing. */
export function PageCrumb({ title }: { title: string }) {
  const { set } = useContext(Crumb);
  useEffect(() => {
    set(title);
    return () => set(null);
  }, [set, title]);
  return null;
}

export function AppBreadcrumb({ club }: { club: string }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { title } = useContext(Crumb);

  const section = NAVIGATION.flatMap((group) => group.items).find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const onSection = section && pathname === section.href;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-sm">
        <li className="label-caps hidden shrink-0 text-muted-foreground sm:block">
          {club}
        </li>
        {section ? (
          <>
            <li aria-hidden className="hidden text-muted-foreground/60 sm:block">
              /
            </li>
            <li className="shrink-0">
              {onSection ? (
                <span aria-current="page" className="font-medium">
                  {t(section.titleKey)}
                </span>
              ) : (
                <Link href={section.href} className="text-muted-foreground hover:text-foreground">
                  {t(section.titleKey)}
                </Link>
              )}
            </li>
          </>
        ) : null}
        {title && !onSection ? (
          <>
            <li aria-hidden className="text-muted-foreground/60">
              /
            </li>
            <li
              aria-current="page"
              className="min-w-0 truncate rounded-md bg-orange-500/10 px-2 py-0.5 font-semibold text-orange-700 dark:text-orange-400"
            >
              {title}
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  );
}
