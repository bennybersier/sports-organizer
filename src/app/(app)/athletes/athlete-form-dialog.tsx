"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect, type MultiSelectOption } from "@/components/data/multi-select";
import { createAthleteAction, updateAthleteAction } from "@/server/actions/athletes";

export interface AthleteFormValues {
  id?: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  gender: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  membershipStatus: string;
  notes: string | null;
}

const GENDERS = ["UNSPECIFIED", "MALE", "FEMALE", "MIXED", "OTHER"] as const;
const MEMBERSHIP = ["ACTIVE", "TRIAL", "INACTIVE", "SUSPENDED"] as const;

const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth: z.string().optional(),
  gender: z.enum(GENDERS),
  email: z.union([z.literal(""), z.email()]).optional(),
  phone: z.string().trim().max(40).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(120).optional(),
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactPhone: z.string().trim().max(40).optional(),
  emergencyContactRelation: z.string().trim().max(60).optional(),
  membershipStatus: z.enum(MEMBERSHIP),
  notes: z.string().trim().max(2000).optional(),
});

type Values = z.infer<typeof schema>;

export function AthleteFormDialog({
  mode,
  athlete,
  teams,
  currentTeamIds,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  athlete?: AthleteFormValues;
  teams: MultiSelectOption[];
  currentTeamIds?: string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations("athletes");
  const tCommon = useTranslations("common");
  const tGender = useTranslations("gender");
  const tMembership = useTranslations("membershipState");
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [teamIds, setTeamIds] = useState<string[]>(currentTeamIds ?? []);

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: athlete?.firstName ?? "",
      lastName: athlete?.lastName ?? "",
      dateOfBirth: athlete?.dateOfBirth ?? "",
      gender: (athlete?.gender as (typeof GENDERS)[number]) ?? "UNSPECIFIED",
      email: athlete?.email ?? "",
      phone: athlete?.phone ?? "",
      addressLine1: athlete?.addressLine1 ?? "",
      postalCode: athlete?.postalCode ?? "",
      city: athlete?.city ?? "",
      emergencyContactName: athlete?.emergencyContactName ?? "",
      emergencyContactPhone: athlete?.emergencyContactPhone ?? "",
      emergencyContactRelation: athlete?.emergencyContactRelation ?? "",
      membershipStatus: (athlete?.membershipStatus as (typeof MEMBERSHIP)[number]) ?? "ACTIVE",
      notes: athlete?.notes ?? "",
    },
  });

  async function onSubmit(values: Values) {
    setFormError(null);
    const payload = { ...(mode === "edit" ? { id: athlete?.id } : {}), ...values, teamIds };
    const result =
      mode === "create" ? await createAthleteAction(payload) : await updateAthleteAction(payload);

    if (!result.ok) {
      setFormError(result.error.message);
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        if (field in values) form.setError(field as keyof Values, { message: messages[0] });
      }
      return;
    }

    toast.success(
      mode === "create"
        ? t("created", { name: result.data.name })
        : t("updated", { name: result.data.name }),
    );
    setOpen(false);
    router.refresh();
  }

  const text = (name: keyof Values, label: string, type = "text") => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} {...field} value={(field.value as string) ?? ""} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {mode === "create" && controlledOpen === undefined ? (
        <DialogTrigger asChild>
          <Button>
            <Plus aria-hidden />
            {t("new")}
          </Button>
        </DialogTrigger>
      ) : null}

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? t("new") : t("edit")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        {formError ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {text("firstName", t("firstName"))}
                  {text("lastName", t("lastName"))}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {text("dateOfBirth", t("dateOfBirth"), "date")}
                  <FormField
                    control={form.control}
                    name="gender"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tCommon("category")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {GENDERS.map((g) => (
                              <SelectItem key={g} value={g}>
                                {tGender(g)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {text("email", tCommon("email"), "email")}
                  {text("phone", tCommon("phone"), "tel")}
                </div>

                {teams.length > 0 ? (
                  <FormItem>
                    <FormLabel>{t("teams")}</FormLabel>
                    <MultiSelect
                      options={teams}
                      value={teamIds}
                      onChange={setTeamIds}
                      placeholder={t("teams")}
                      emptyText={tCommon("none")}
                    />
                  </FormItem>
                ) : null}

                <FormField
                  control={form.control}
                  name="membershipStatus"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("membershipStatus")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {MEMBERSHIP.map((m) => (
                            <SelectItem key={m} value={m}>
                              {tMembership(m)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 sm:grid-cols-3">
                  {text("postalCode", tCommon("postalCode"))}
                  <div className="sm:col-span-2">{text("city", tCommon("city"))}</div>
                </div>

                <fieldset className="space-y-4 rounded-lg border p-3">
                  <legend className="px-1 text-sm font-medium">{t("emergencyContact")}</legend>
                  {text("emergencyContactName", t("emergencyName"))}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {text("emergencyContactPhone", t("emergencyPhone"), "tel")}
                    {text("emergencyContactRelation", t("emergencyRelation"))}
                  </div>
                </fieldset>

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {tCommon("notes")}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({tCommon("optional")})
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Textarea rows={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </ScrollArea>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    {tCommon("saving")}
                  </>
                ) : mode === "create" ? (
                  t("create")
                ) : (
                  t("save")
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
