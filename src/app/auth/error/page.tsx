import Link from "next/link";
import { CalendarClock, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const REASONS: Record<string, string> = {
  missing_code: "The sign-in link was incomplete. Please start again.",
  exchange_failed: "That sign-in link has already been used or has expired.",
  access_denied: "Sign-in was cancelled.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message =
    (reason && REASONS[reason]) ?? "We couldn't complete sign-in. Please try again.";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <CalendarClock className="size-4" aria-hidden />
        </span>
        Sport Club Organizer
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="size-5" aria-hidden />
          </div>
          <CardTitle>Sign-in failed</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
