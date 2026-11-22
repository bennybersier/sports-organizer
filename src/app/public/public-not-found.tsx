"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, LinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Every 404 under /public — never the app's, whose way out is a dashboard a
 * parent has no account for.
 *
 * Below a team's page (a match or player that is not, or no longer, on it)
 * the way back is that team's page. On the team's page itself the link is
 * what failed — revoked, mistyped, or the team gone, told apart for nobody —
 * so there is nowhere to send them back to, and no button that would only
 * lead to this page again.
 *
 * The path is read in the browser because a not-found boundary is given no
 * route params.
 */
export function PublicNotFound() {
  const t = useTranslations("publicTeam");
  const pathname = usePathname() ?? "";
  // ["public", "teams", token, ...below]
  const [, kind, token, ...below] = pathname.split("/").filter(Boolean);
  const teamHref = kind === "teams" && token ? `/public/teams/${token}` : null;
  const insideTeam = teamHref !== null && below.length > 0;

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <LinkIcon className="size-5" aria-hidden />
        </span>
        <p className="label-caps text-muted-foreground">404</p>
        <h1 className="text-lg font-bold">
          {insideTeam ? t("missingTitle") : t("goneTitle")}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {insideTeam ? t("missingBody") : t("goneBody")}
        </p>
        {insideTeam ? (
          <Button asChild className="mt-2">
            <Link href={teamHref}>
              <ArrowLeft aria-hidden />
              {t("backToTeam")}
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
