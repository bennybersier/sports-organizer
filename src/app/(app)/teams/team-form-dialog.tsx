"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, Pencil, Plus } from "lucide-react";
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
  FormDescription,
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

/**
 * Radix refuses an empty string as a Select value — it reserves it for "no
 * selection" — so "nobody leads this side yet" needs a token of its own.
 */
const NO_HEAD_COACH = "__none__";
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
  homeGymId: string | null;
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
  homeGymId: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  notes: z.string().trim().max(2000).optional(),
});

type Values = z.infer<typeof schema>;

export function TeamFormDialog({
  mode,
  team,
  seasons,
  trainers,
  gyms,
  defaultSeasonId,
  initialTrainerIds,
  initialHeadCoachId,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  team?: TeamFormValues;
  seasons: MultiSelectOption[];
  trainers: MultiSelectOption[];
  gyms: MultiSelectOption[];
  defaultSeasonId?: string;
  initialTrainerIds?: string[];
  initialHeadCoachId?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const tRelated = useTranslations("related");
  const tGender = useTranslations("gender");
  const [formError, setFormError] = useState<string | null>(null);
  // The row menu fetches current assignments before mounting this dialog, so
  // the initial state is already correct — no effect needed to sync it.
  const [trainerIds, setTrainerIds] = useState<string[]>(initialTrainerIds ?? []);
  // Carried through the form even though it is edited more often on the team's
  // own page: submitting without it would demote whoever is leading the side.
  const [headCoachId, setHeadCoachId] = useState<string>(initialHeadCoachId ?? "");

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      seasonId: team?.seasonId ?? defaultSeasonId ?? "",
      name: team?.name ?? "",
      sport: team?.sport ?? "",
      category: team?.category ?? "",
      ageGroup: team?.ageGroup ?? "",
      gender: (team?.gender as (typeof GENDERS)[number]) ?? "UNSPECIFIED",
      homeGymId: team?.homeGymId ?? "",
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
    const payload = {
      ...(mode === "edit" ? { id: team?.id } : {}),
      ...values,
      trainerIds,
      // A head coach who is no longer on the staff is not a head coach.
      headCoachId: trainerIds.includes(headCoachId) ? headCoachId : "",
    };
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
      {/*
        The same dialog opens from a list row and from the record's own page,
        so it carries its own button rather than each caller inventing one.
        A controlled caller — a dropdown that has already been clicked — passes
        `open` and gets no trigger at all.
      */}
      {controlledOpen === undefined ? (
        <DialogTrigger asChild>
          <Button size="sm" variant={mode === "create" ? "default" : "outline"}>
            {mode === "create" ? <Plus aria-hidden /> : <Pencil aria-hidden />}
            {mode === "create" ? t("new") : tCommon("edit")}
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
                name="homeGymId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("homeGym")}</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                      value={field.value || "none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/* A side may genuinely have none — every fixture away,
                            or the hall not settled yet. */}
                        <SelectItem value="none">{tCommon("none")}</SelectItem>
                        {gyms.map((gym) => (
                          <SelectItem key={gym.value} value={gym.value}>
                            {gym.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>{t("homeGymHint")}</FormDescription>
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
              <>
                <FormItem>
                  <FormLabel>{t("trainers")}</FormLabel>
                  <MultiSelect
                    options={trainers}
                    value={trainerIds}
                    onChange={(next) => {
                      setTrainerIds(next);
                      if (!next.includes(headCoachId)) setHeadCoachId("");
                    }}
                    placeholder={t("trainers")}
                    emptyText={tCommon("none")}
                  />
                </FormItem>

                {/* Only offered once there is somebody to choose from. */}
                {trainerIds.length > 0 ? (
                  <FormItem>
                    <FormLabel>{tRelated("headCoach")}</FormLabel>
                    <Select
                      value={headCoachId || NO_HEAD_COACH}
                      onValueChange={(value) =>
                        setHeadCoachId(value === NO_HEAD_COACH ? "" : value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_HEAD_COACH}>{tRelated("noHeadCoachYet")}</SelectItem>
                        {trainers
                          .filter((trainer) => trainerIds.includes(trainer.value))
                          .map((trainer) => (
                            <SelectItem key={trainer.value} value={trainer.value}>
                              {trainer.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                ) : null}
              </>
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
