"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/server/actions/auth";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation/auth";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const t = useTranslations("auth");

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("checkInbox")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle2 aria-hidden />
            <AlertTitle>{t("resetLinkSent")}</AlertTitle>
<AlertDescription>{t("resetLinkSentBody")}</AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">
              <ArrowLeft aria-hidden />
              {t("backToSignIn")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("resetTitle")}</CardTitle>
<CardDescription>{t("resetSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(async (values) => {
              await requestPasswordReset(values);
              // Always report success — this form must not reveal which
              // addresses have accounts.
              setSent(true);
            })}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("email")}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  {t("sending")}
                </>
              ) : (
                t("sendResetLink")
              )}
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/login">
                <ArrowLeft aria-hidden />
                {t("backToSignIn")}
              </Link>
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
