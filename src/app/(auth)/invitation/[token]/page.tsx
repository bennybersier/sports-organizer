import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Clock, MailQuestion, ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/server/auth/context";
import { describeInvitation } from "@/server/services/invitation-service";

import { AcceptInvitationForm } from "./accept-invitation-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invitation");
  return { title: t("accept") };
}

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("invitation");
  const [invitation, user] = await Promise.all([describeInvitation(token), getCurrentUser()]);

  if (invitation.status !== "VALID") {
    return <InvitationProblem status={invitation.status} />;
  }

  // Not signed in: send them to sign in and come straight back here.
  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("invitedTo", { club: invitation.tenantName ?? "" })}</CardTitle>
          <CardDescription>
            {t("signInAs", { email: invitation.email ?? "", role: invitation.roleName ?? "" })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href={`/login?next=${encodeURIComponent(`/invitation/${token}`)}`}>
              {t("signInToAccept")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Signed in as somebody else: say so plainly rather than failing on submit.
  if (user.email.toLowerCase() !== invitation.email?.toLowerCase()) {
    return (
      <Card>
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <MailQuestion className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-xl">{t("wrongAccountTitle")}</CardTitle>
          <CardDescription>
            {t("wrongAccountBody", { invited: invitation.email ?? "", current: user.email })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/dashboard">{t("goToDashboard")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <AcceptInvitationForm
      token={token}
      tenantName={invitation.tenantName ?? "the club"}
      roleName={invitation.roleName ?? "member"}
    />
  );
}

async function InvitationProblem({ status }: { status: string }) {
  const t = await getTranslations("invitation");
  const tAuth = await getTranslations("auth");

  const copy: Record<string, { title: string; description: string; icon: React.ReactNode }> = {
    EXPIRED: {
      title: t("expiredTitle"),
      description: t("expiredBody"),
      icon: <Clock className="size-5" aria-hidden />,
    },
    ALREADY_USED: {
      title: t("usedTitle"),
      description: t("usedBody"),
      icon: <ShieldX className="size-5" aria-hidden />,
    },
    REVOKED: {
      title: t("revokedTitle"),
      description: t("revokedBody"),
      icon: <ShieldX className="size-5" aria-hidden />,
    },
    NOT_FOUND: {
      title: t("notFoundTitle"),
      description: t("notFoundBody"),
      icon: <MailQuestion className="size-5" aria-hidden />,
    },
  };

  const { title, description, icon } = copy[status] ?? copy.NOT_FOUND;

  return (
    <Card>
      <CardHeader>
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">{tAuth("backToSignIn")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
