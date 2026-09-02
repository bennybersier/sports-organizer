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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect, type MultiSelectOption } from "@/components/data/multi-select";
import { useFormDialog } from "@/hooks/use-form-dialog";
import { createTeamAction, updateTeamAction } from "@/server/actions/teams";

export interface TeamFormValues {
  id?: string;
  seasonId: string;
  name: string;
  sport: string;
  category: string | null;
  ageGroup: string | null;
  gender: string;
  color: string;
  notes: string | null;
}

const GENDERS = ["UNSPECIFIED", "MALE", "FEMALE", "MIXED", "OTHER"] as const;

const schema = z.object({
  seasonId: z.uuid(),
  name: z.string().trim().min(1).max(150),
  sport: z.string().trim().min(1).max(80),
  category: z.string().trim().max(80).optional(),
  ageGroup: z.string().trim().max(40).optional(),
  gender: z.enum(GENDERS),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  notes: z.string().trim().max(2000).optional(),
});

type Values = z.infer<typeof schema>;

export function TeamFormDialog({
  mode,
  team,
  seasons,
  trainers,
  defaultSeasonId,
  initialTrainerIds,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  team?: TeamFormValues;
  seasons: MultiSelectOption[];
  trainers: MultiSelectOption[];
  defaultSeasonId?: string;
  initialTrainerIds?: string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const tGender = useTranslations("gender");
  const [formError, setFormError] = useState<string | null>(null);
  // The row menu fetches current assignments before mounting this dialog, so
  // the initial state is already correct — no effect needed to sync it.
  const [trainerIds, setTrainerIds] = useState<string[]>(initialTrainerIds ?? []);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      seasonId: team?.seasonId ?? defaultSeasonId ?? "",
      name: team?.name ?? "",
      sport: team?.sport ?? "",
      category: team?.category ?? "",
      ageGroup: team?.ageGroup ?? "",
      gender: (team?.gender as (typeof GENDERS)[number]) ?? "UNSPECIFIED",
      color: team?.color ?? "#2563eb",
      notes: team?.notes ?? "",
    },
  });

  // Trainer assignments are separate state, so clearing the form alone would
  // leave the previous team's coaches selected.
  const [open, setOpen] = useFormDialog({
    open: controlledOpen,
    onOpenChange,
    onOpen: () => {
      setFormError(null);
      if (mode === "create") {
        form.reset({
          seasonId: defaultSeasonId ?? "",
          name: "",
          sport: "",
          category: "",
          ageGroup: "",
          gender: "UNSPECIFIED",
          color: "#2563eb",
          notes: "",
        });
        setTrainerIds([]);
      }
    },
  });

  async function onSubmit(values: Values) {
    setFormError(null);
    const payload = { ...(mode === "edit" ? { id: team?.id } : {}), ...values, trainerIds };
    const result =
      mode === "create" ? await createTeamAction(payload) : await updateTeamAction(payload);

    if (!result.ok) {
      setFormError(result.error.message);
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("name")}</FormLabel>
                  <FormControl>
                    <Input autoFocus placeholder="U16 Boys" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="seasonId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("season")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {seasons.map((season) => (
                          <SelectItem key={season.value} value={season.value}>
                            {season.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sport"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("sport")}</FormLabel>
                    <FormControl>
                      <Input placeholder="Volleyball" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="ageGroup"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ageGroup")}</FormLabel>
                    <FormControl>
                      <Input placeholder="U16" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("gender")}</FormLabel>
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
              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("colour")}</FormLabel>
                    <FormControl>
                      <Input type="color" className="h-9 w-full" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {trainers.length > 0 ? (
              <FormItem>
                <FormLabel>{t("trainers")}</FormLabel>
                <MultiSelect
                  options={trainers}
                  value={trainerIds}
                  onChange={setTrainerIds}
                  placeholder={t("trainers")}
                  emptyText={tCommon("none")}
                />
              </FormItem>
            ) : null}

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

            <DialogFooter>
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
