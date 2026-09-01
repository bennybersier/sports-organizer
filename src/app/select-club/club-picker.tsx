"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Loader2 } from "lucide-react";

import { CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { setActiveTenant } from "@/server/actions/auth";

interface Club {
  id: string;
  name: string;
  roleName: string;
}

export function ClubPicker({ clubs }: { clubs: Club[] }) {
  const router = useRouter();
  const tErrors = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function choose(clubId: string) {
    setError(null);
    setPendingId(clubId);
    startTransition(async () => {
      const result = await setActiveTenant(clubId);
      if (!result.ok) {
        setError(result.error.message || tErrors(result.error.code));
        setPendingId(null);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    });
  }

  return (
    <CardContent className="space-y-2">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="space-y-2">
        {clubs.map((club) => (
          <li key={club.id}>
            <button
              type="button"
              onClick={() => choose(club.id)}
              disabled={pendingId !== null}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
            >
              <span className="grid flex-1">
                <span className="font-medium">{club.name}</span>
                <span className="text-sm text-muted-foreground">{club.roleName}</span>
              </span>
              {pendingId === club.id ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
    </CardContent>
  );
}
