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
import { useFormDialog } from "@/hooks/use-form-dialog";
import { createTrainerAction, updateTrainerAction } from "@/server/actions/trainers";

export interface TrainerFormValues {
  id?: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  qualifications: string[];
  color: string | null;
  notes: string | null;
}

const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.union([z.literal(""), z.email()]).optional(),
  phone: z.string().trim().max(40).optional(),
  qualificationsText: z.string().optional(),
  color: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
});

type Values = z.infer<typeof schema>;

const toList = (text: string | undefined) =>
  (text ?? "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function TrainerFormDialog({
  mode,
  trainer,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  trainer?: TrainerFormValues;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations("trainers");
  const tCommon = useTranslations("common");
  const [formError, setFormError] = useState<string | null>(null);

  const blank: Values = {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    qualificationsText: "",
    color: "",
    notes: "",
  };

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: trainer?.firstName ?? "",
      lastName: trainer?.lastName ?? "",
      email: trainer?.email ?? "",
      phone: trainer?.phone ?? "",
      qualificationsText: (trainer?.qualifications ?? []).join("\n"),
      color: trainer?.color ?? "",
      notes: trainer?.notes ?? "",
    },
  });

  const [open, setOpen] = useFormDialog({
    open: controlledOpen,
    onOpenChange,
    onOpen: () => {
      setFormError(null);
      if (mode === "create") form.reset(blank);
    },
  });

  async function onSubmit(values: Values) {
    setFormError(null);
    const payload = {
      ...(mode === "edit" ? { id: trainer?.id } : {}),
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      phone: values.phone,
      qualifications: toList(values.qualificationsText),
      color: values.color,
      notes: values.notes,
    };

    const result =
      mode === "create" ? await createTrainerAction(payload) : await updateTrainerAction(payload);

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
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("firstName")}</FormLabel>
                    <FormControl>
                      <Input autoFocus autoComplete="given-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("lastName")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="family-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("email")}</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("phone")}</FormLabel>
                    <FormControl>
                      <Input type="tel" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="qualificationsText"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("qualifications")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormDescription>{t("qualificationsHint")}</FormDescription>
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
                    <Input
                      type="color"
                      className="h-9 w-24"
                      {...field}
                      value={field.value || "#16a34a"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
