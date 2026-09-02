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
import { createGymAction, updateGymAction } from "@/server/actions/gyms";

export interface GymFormValues {
  id?: string;
  name: string;
  description: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  capacity: number | null;
  sportTypes: string[];
  equipment: string[];
  color: string | null;
  notes: string | null;
}

const schema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(1000).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(120).optional(),
  capacity: z.string().trim().optional(),
  sportTypesText: z.string().optional(),
  equipmentText: z.string().optional(),
  color: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
});

type Values = z.infer<typeof schema>;

/** Newline- or comma-separated free text into a clean list. */
const toList = (text: string | undefined) =>
  (text ?? "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function GymFormDialog({
  mode,
  gym,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  gym?: GymFormValues;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations("gyms");
  const tCommon = useTranslations("common");
  const [formError, setFormError] = useState<string | null>(null);

  const blank: Values = {
    name: "",
    description: "",
    addressLine1: "",
    postalCode: "",
    city: "",
    capacity: "",
    sportTypesText: "",
    equipmentText: "",
    color: "",
    notes: "",
  };

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: gym?.name ?? "",
      description: gym?.description ?? "",
      addressLine1: gym?.addressLine1 ?? "",
      postalCode: gym?.postalCode ?? "",
      city: gym?.city ?? "",
      capacity: gym?.capacity ? String(gym.capacity) : "",
      sportTypesText: (gym?.sportTypes ?? []).join("\n"),
      equipmentText: (gym?.equipment ?? []).join("\n"),
      color: gym?.color ?? "",
      notes: gym?.notes ?? "",
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
      ...(mode === "edit" ? { id: gym?.id } : {}),
      name: values.name,
      description: values.description,
      addressLine1: values.addressLine1,
      postalCode: values.postalCode,
      city: values.city,
      capacity: values.capacity,
      sportTypes: toList(values.sportTypesText),
      equipment: toList(values.equipmentText),
      color: values.color,
      notes: values.notes,
    };

    const result =
      mode === "create" ? await createGymAction(payload) : await updateGymAction(payload);

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
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="space-y-4">
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

                <FormField
                  control={form.control}
                  name="addressLine1"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tCommon("address")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="postalCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tCommon("postalCode")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>{tCommon("city")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="capacity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("capacity")}</FormLabel>
                        <FormControl>
                          <Input type="number" min={1} {...field} />
                        </FormControl>
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
                          <Input type="color" className="h-9 w-full" {...field} value={field.value || "#2563eb"} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="sportTypesText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("sportTypes")}</FormLabel>
                      <FormControl>
                        <Textarea rows={2} placeholder="Volleyball&#10;Basketball" {...field} />
                      </FormControl>
                      <FormDescription>{t("sportTypesHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="equipmentText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("equipment")}</FormLabel>
                      <FormControl>
                        <Textarea rows={2} {...field} />
                      </FormControl>
                      <FormDescription>{t("equipmentHint")}</FormDescription>
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
              </div>

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
