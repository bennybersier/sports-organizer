"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Check, Copy, Loader2, Plus } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { createTenant, type CreateTenantResult } from "@/server/actions/platform-admin";

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
  const [created, setCreated] = useState<CreateTenantResult | null>(null);
  const [copied, setCopied] = useState(false);

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
    router.refresh();

    // A brand-new owner has an account but no way to reach it until email is
    // wired up, so hand the link over instead of closing on a silent success.
    if (result.data.ownerInvited) {
      setCreated(result.data);
      return;
    }

    setOpen(false);
    form.reset();
  }

  function close() {
    setOpen(false);
    setCreated(null);
    setCopied(false);
    form.reset();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New club
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        {created?.inviteLink ? (
          <>
            <DialogHeader>
              <DialogTitle>Club created — send the owner their link</DialogTitle>
              <DialogDescription>
                {created.ownerEmail} had no account, so one was created and they were made
                Owner. Email delivery isn&apos;t wired up yet, so pass this link on yourself.
                It sets their password and expires.
              </DialogDescription>
            </DialogHeader>

            <Alert>
              <AlertCircle aria-hidden />
              <AlertTitle>Single use</AlertTitle>
              <AlertDescription>
                This link signs them in once to choose a password. It won&apos;t be shown
                again — if it&apos;s lost, they can use “Forgot password” instead.
              </AlertDescription>
            </Alert>

            <div className="flex items-center gap-2">
              <Input readOnly value={created.inviteLink} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy invitation link"
                onClick={async () => {
                  await navigator.clipboard.writeText(created.inviteLink!);
                  setCopied(true);
                  toast.success("Link copied.");
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </div>

            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
        <>
        <DialogHeader>
          <DialogTitle>Create a club</DialogTitle>
          <DialogDescription>
            A club is a tenant — one organisation, with its own teams, athletes, gyms and
            schedules, isolated from every other.
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
                  <FormDescription>
                    Defaults to you. If this address has no account yet, one is created and
                    you&apos;ll get an invitation link to pass on.
                  </FormDescription>
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
              <Button type="button" variant="outline" onClick={close}>
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
        </>
        )}
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
