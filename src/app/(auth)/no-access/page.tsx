import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MailQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser, getMemberships } from "@/server/auth/context";
import { signOut } from "@/server/actions/auth";

export const metadata: Metadata = { title: "No club access" };

/**
 * Signed in, but not a member of any club.
 *
 * This is the intended landing spot for a Google sign-in by someone who was
 * never invited: authentication succeeded, but authentication is not
 * membership, and no club membership is ever created implicitly.
 */
export default async function NoAccessPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const memberships = await getMemberships();
  if (memberships.length > 0) redirect("/dashboard");

  return (
    <Card>
      <CardHeader>
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <MailQuestion className="size-5" aria-hidden />
        </div>
        <CardTitle className="text-xl">You&apos;re not in a club yet</CardTitle>
        <CardDescription>
          You&apos;re signed in as <strong>{user.email}</strong>, but you don&apos;t belong to any
          club. Clubs are invitation-only — ask an administrator to invite this address, then open
          the link in the invitation email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={signOut}>
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
