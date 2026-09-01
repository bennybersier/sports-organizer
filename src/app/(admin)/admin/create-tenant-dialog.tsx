"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";

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
import { createTenant } from "@/server/actions/platform-admin";

const schema = z.object({
  name: z.string().trim().min(2, "Give the club a name.").max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/, "3–50 lowercase letters, numbers and hyphens."),
  ownerEmail: z.email("Enter the owner's email address."),
  timezone: z.string().min(1),
});

type Values = z.infer<typeof schema>;

export function CreateTenantDialog({ defaultOwnerEmail }: { defaultOwnerEmail: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      slug: "",
      ownerEmail: defaultOwnerEmail,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Zurich",
    },
  });

  // Suggest a slug from the name until the user edits the slug themselves.
  function onNameChange(value: string) {
    form.setValue("name", value);
    if (!form.getFieldState("slug").isDirty) {
      form.setValue("slug", slugify(value));
    }
  }

  async function onSubmit(values: Values) {
    setFormError(null);
    const result = await createTenant(values);

    if (!result.ok) {
      setFormError(result.error.message);
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        form.setError(field as keyof Values, { message: messages[0] });
      }
      return;
    }

    toast.success(`Created ${values.name}.`);
    setOpen(false);
    form.reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New club
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a club</DialogTitle>
          <DialogDescription>
            The owner needs an account already — this assigns access, it never creates an
            identity.
          </DialogDescription>
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
                  <FormLabel>Club name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      placeholder="Riverside Athletics"
                      onChange={(event) => onNameChange(event.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="riverside-athletics" />
                  </FormControl>
                  <FormDescription>Lowercase letters, numbers and hyphens.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="ownerEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Europe/Zurich" />
                  </FormControl>
                  <FormDescription>
                    Recurring availability is interpreted in this timezone.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Creating…
                  </>
                ) : (
                  "Create club"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}
