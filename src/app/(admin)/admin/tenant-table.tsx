"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogIn, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { enterTenantAsStaff } from "@/server/actions/platform-admin";

export interface AdminTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  member_count: number;
  team_count: number;
  athlete_count: number;
  season_count: number;
  deleted_at: string | null;
}

export function TenantTable({ tenants }: { tenants: AdminTenant[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function enter(tenant: AdminTenant) {
    setPendingId(tenant.id);
    startTransition(async () => {
      const result = await enterTenantAsStaff(tenant.id);
      if (!result.ok) {
        toast.error(result.error.message);
        setPendingId(null);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Club</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead className="text-right">Seasons</TableHead>
            <TableHead className="text-right">Teams</TableHead>
            <TableHead className="text-right">Athletes</TableHead>
            <TableHead className="sr-only">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.map((tenant) => (
            <TableRow key={tenant.id}>
              <TableCell>
                <div className="font-medium">{tenant.name}</div>
                <div className="text-xs text-muted-foreground">/{tenant.slug}</div>
              </TableCell>
              <TableCell>
                <Badge variant={tenant.deleted_at ? "destructive" : "secondary"}>
                  {tenant.deleted_at ? "Deleted" : tenant.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{tenant.member_count}</TableCell>
              <TableCell className="text-right tabular-nums">{tenant.season_count}</TableCell>
              <TableCell className="text-right tabular-nums">{tenant.team_count}</TableCell>
              <TableCell className="text-right tabular-nums">{tenant.athlete_count}</TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingId !== null}
                  onClick={() => enter(tenant)}
                >
                  {pendingId === tenant.id ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <LogIn aria-hidden />
                  )}
                  Enter
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
