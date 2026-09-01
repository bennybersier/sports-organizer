"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { updatePassword } from "@/server/actions/auth";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validation/auth";

export function ResetPasswordForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("newPasswordTitle")}</CardTitle>
        <CardDescription>{t("newPasswordSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
              const result = await updatePassword(values);
              if (!result.ok) {
                setFormError(result.error.message);
                return;
              }
              router.replace("/dashboard");
              router.refresh();
            })}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("newPassword")}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" autoFocus {...field} />
                  </FormControl>
                  <FormDescription>{t("passwordHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("confirmPassword")}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  {tCommon("saving")}
                </>
              ) : (
                t("savePassword")
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
