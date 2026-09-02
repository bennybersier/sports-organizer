"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("admin");
  const tErrors = useTranslations("errors");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function enter(tenant: AdminTenant) {
    setPendingId(tenant.id);
    startTransition(async () => {
      const result = await enterTenantAsStaff(tenant.id);
      if (!result.ok) {
        toast.error(result.error.message || tErrors(result.error.code));
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
            <TableHead>{t("club")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead className="text-right">{t("members")}</TableHead>
            <TableHead className="text-right">{t("seasons")}</TableHead>
            <TableHead className="text-right">{t("teams")}</TableHead>
            <TableHead className="text-right">{t("athletes")}</TableHead>
            <TableHead className="sr-only">{t("actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.map((tenant) => (
            <TableRow key={tenant.id}>
              <TableCell variant="primary">
                <div className="font-medium">{tenant.name}</div>
                <div className="text-xs text-muted-foreground">/{tenant.slug}</div>
              </TableCell>
              <TableCell data-label={t("status")}>
                <Badge variant={tenant.deleted_at ? "destructive" : "secondary"}>
                  {tenant.deleted_at ? t("deleted") : tenant.status}
                </Badge>
              </TableCell>
              <TableCell data-label={t("members")} className="text-right tabular-nums">{tenant.member_count}</TableCell>
              <TableCell data-label={t("seasons")} className="text-right tabular-nums">{tenant.season_count}</TableCell>
              <TableCell data-label={t("teams")} className="text-right tabular-nums">{tenant.team_count}</TableCell>
              <TableCell data-label={t("athletes")} className="text-right tabular-nums">{tenant.athlete_count}</TableCell>
              <TableCell variant="actions" className="text-right">
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
                  {t("enter")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
