import type { Metadata } from "next";
import Link from "next/link";
import { Clock, MailQuestion, ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/server/auth/context";
import { describeInvitation } from "@/server/services/invitation-service";

import { AcceptInvitationForm } from "./accept-invitation-form";

export const metadata: Metadata = { title: "Club invitation" };

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [invitation, user] = await Promise.all([describeInvitation(token), getCurrentUser()]);

  if (invitation.status !== "VALID") {
    return <InvitationProblem status={invitation.status} />;
  }

  // Not signed in: send them to sign in and come straight back here.
  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">You&apos;re invited to {invitation.tenantName}</CardTitle>
          <CardDescription>
            Sign in as <strong>{invitation.email}</strong> to join as {invitation.roleName}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href={`/login?next=${encodeURIComponent(`/invitation/${token}`)}`}>
              Sign in to accept
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
          <CardTitle className="text-xl">This invitation is for someone else</CardTitle>
          <CardDescription>
            It was sent to <strong>{invitation.email}</strong>, but you&apos;re signed in as{" "}
            <strong>{user.email}</strong>. Sign out and sign back in with the invited address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/dashboard">Go to your dashboard</Link>
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

function InvitationProblem({ status }: { status: string }) {
  const copy: Record<string, { title: string; description: string; icon: React.ReactNode }> = {
    EXPIRED: {
      title: "This invitation has expired",
      description: "Ask a club administrator to send you a new one.",
      icon: <Clock className="size-5" aria-hidden />,
    },
    ALREADY_USED: {
      title: "This invitation has already been used",
      description: "If it was you, just sign in. Otherwise ask for a new invitation.",
      icon: <ShieldX className="size-5" aria-hidden />,
    },
    REVOKED: {
      title: "This invitation was withdrawn",
      description: "A club administrator revoked it. Get in touch with them if that's unexpected.",
      icon: <ShieldX className="size-5" aria-hidden />,
    },
    NOT_FOUND: {
      title: "We couldn't find that invitation",
      description: "The link may be incomplete. Copy it from your email again, in full.",
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
          <Link href="/login">Back to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
