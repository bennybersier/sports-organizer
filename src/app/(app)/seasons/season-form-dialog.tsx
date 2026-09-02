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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createSeasonAction, updateSeasonAction } from "@/server/actions/seasons";

export interface SeasonFormValues {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  description: string | null;
}

const schema = z
  .object({
    name: z.string().trim().min(1).max(100),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: " " });

type Values = z.infer<typeof schema>;

/** Create and edit share a form; only the title, submit label and action differ. */
export function SeasonFormDialog({
  mode,
  season,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  season?: SeasonFormValues;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations("seasons");
  const tCommon = useTranslations("common");
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: season?.name ?? "",
      startDate: season?.startDate ?? defaultStart(),
      endDate: season?.endDate ?? defaultEnd(),
      description: season?.description ?? "",
    },
  });

  async function onSubmit(values: Values) {
    setFormError(null);
    const result =
      mode === "create"
        ? await createSeasonAction(values)
        : await updateSeasonAction({ ...values, id: season?.id });

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
    form.reset(mode === "create" ? undefined : values);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : mode === "create" ? (
        <DialogTrigger asChild>
          <Button>
            <Plus aria-hidden />
            {t("new")}
          </Button>
        </DialogTrigger>
      ) : null}

      <DialogContent className="sm:max-w-md">
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
                    <Input autoFocus placeholder="2026/2027" {...field} />
                  </FormControl>
                  <FormDescription>{t("nameHint")}</FormDescription>
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

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("descriptionField")}{" "}
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

/** A season usually runs August to June, so default to the coming one. */
function defaultStart(): string {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-08-01`;
}

function defaultEnd(): string {
  const start = defaultStart();
  return `${Number(start.slice(0, 4)) + 1}-06-30`;
}
