"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Label } from "@/components/ui/label";
import { duplicateSeasonAction } from "@/server/actions/seasons";

const schema = z
  .object({
    name: z.string().trim().min(1).max(100),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    includeTeams: z.boolean(),
    includeAvailability: z.boolean(),
    includeAthletes: z.boolean(),
  })
  .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: " " });

type Values = z.infer<typeof schema>;

/**
 * Season duplication, made explicit and reviewable.
 *
 * The organizer chooses what carries over rather than getting a blind copy —
 * and schedules and past events are never among the options, because last
 * year's Tuesday training is history, not a template.
 */
export function DuplicateSeasonDialog({
  season,
  open,
  onOpenChange,
}: {
  season: { id: string; name: string; startDate: string; endDate: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations("seasons");
  const tCommon = useTranslations("common");
  const [formError, setFormError] = useState<string | null>(null);

  const nextYear = (iso: string) => {
    const [y, rest] = [iso.slice(0, 4), iso.slice(4)];
    return `${Number(y) + 1}${rest}`;
  };

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: bumpYears(season.name),
      startDate: nextYear(season.startDate),
      endDate: nextYear(season.endDate),
      includeTeams: true,
      includeAvailability: true,
      includeAthletes: false,
    },
  });

  const options = [
    { name: "includeTeams" as const, label: t("duplicateTeams") },
    { name: "includeAvailability" as const, label: t("duplicateAvailability") },
    { name: "includeAthletes" as const, label: t("duplicateAthletes") },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("duplicateTitle", { name: season.name })}</DialogTitle>
          <DialogDescription>{t("duplicateBody")}</DialogDescription>
        </DialogHeader>

        {formError ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(async (values) => {
              setFormError(null);
              const result = await duplicateSeasonAction({
                ...values,
                sourceSeasonId: season.id,
              });
              if (!result.ok) {
                setFormError(result.error.message);
                return;
              }
              toast.success(t("duplicated", { name: result.data.name, source: season.name }));
              onOpenChange(false);
              router.refresh();
            })}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("name")}</FormLabel>
                  <FormControl>
                    <Input autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("startDate")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("endDate")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t("duplicateInclude")}</legend>
              {options.map((option) => (
                <FormField
                  key={option.name}
                  control={form.control}
                  name={option.name}
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          id={option.name}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <Label htmlFor={option.name} className="font-normal">
                        {option.label}
                      </Label>
                    </FormItem>
                  )}
                />
              ))}
            </fieldset>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    {tCommon("creating")}
                  </>
                ) : (
                  t("duplicate")
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** "2026/2027" -> "2027/2028"; anything else is left for the user to edit. */
function bumpYears(name: string): string {
  return name.replace(/\d{4}/g, (year) => String(Number(year) + 1));
}
