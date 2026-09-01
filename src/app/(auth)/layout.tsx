import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarClock } from "lucide-react";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("app");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6 md:p-10">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <CalendarClock className="size-4" aria-hidden />
        </span>
        {t("name")}
      </Link>
      <main className="w-full max-w-sm">{children}</main>
    </div>
  );
}
