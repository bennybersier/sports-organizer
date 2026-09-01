import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, Dumbbell, MapPin, Trophy, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAuthContext } from "@/server/auth/context";
import { hasPermission } from "@/server/auth/authorization";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Phase 1 dashboard.
 *
 * Real counts, read through the RLS-scoped client — no placeholder numbers.
 * The operational panels (upcoming sessions, schedule conflicts, availability
 * gaps, recent activity) arrive with the entities and scheduling engine they
 * report on, in Phases 2–6.
 */
export default async function DashboardPage() {
  const context = await requireAuthContext();
  const { db, tenant } = context;

  const [seasons, teams, athletes, trainers, gyms, activeSeason] = await Promise.all([
    db.from("seasons").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    db
      .from("teams")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null),
    db
      .from("athletes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null),
    db
      .from("trainers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null),
    db
      .from("gyms")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null),
    db
      .from("seasons")
      .select("id, name, start_date, end_date")
      .eq("tenant_id", tenant.id)
      .eq("status", "ACTIVE")
      .maybeSingle(),
  ]);

  const stats = [
    { label: "Teams", value: teams.count ?? 0, icon: Users, href: "/teams", permission: "teams.read" as const },
    { label: "Athletes", value: athletes.count ?? 0, icon: Dumbbell, href: "/athletes", permission: "athletes.read" as const },
    { label: "Trainers", value: trainers.count ?? 0, icon: CalendarDays, href: "/trainers", permission: "trainers.read" as const },
    { label: "Gyms", value: gyms.count ?? 0, icon: MapPin, href: "/gyms", permission: "gyms.read" as const },
  ].filter((stat) => hasPermission(context, stat.permission));

  const needsSetup = (seasons.count ?? 0) === 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">
            {activeSeason.data ? (
              <>
                Active season: <strong>{activeSeason.data.name}</strong>
              </>
            ) : (
              "No active season yet."
            )}
          </p>
        </div>
        <Badge variant="secondary">{context.role.name}</Badge>
      </div>

      {needsSetup ? (
        <Card>
          <CardHeader>
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Trophy className="size-5" aria-hidden />
            </div>
            <CardTitle>Set up your first season</CardTitle>
            <CardDescription>
              Seasons hold your teams, availability and schedules. Create one to get started.
            </CardDescription>
          </CardHeader>
          {hasPermission(context, "seasons.create") ? (
            <CardContent>
              <Button asChild>
                <Link href="/seasons/new">
                  Create a season
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </CardContent>
          ) : (
            <CardContent className="text-sm text-muted-foreground">
              Ask a club organizer to create the first season.
            </CardContent>
          )}
        </Card>
      ) : null}

      {stats.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardDescription>{stat.label}</CardDescription>
                <stat.icon className="size-4 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{stat.value}</div>
                <Link
                  href={stat.href}
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  View all
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
