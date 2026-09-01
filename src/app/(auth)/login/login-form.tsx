"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { signIn, signInWithGoogle } from "@/server/actions/auth";
import { signInSchema, type SignInInput } from "@/lib/validation/auth";
import { GoogleIcon } from "@/components/icons/google-icon";

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(initialError ?? null);
  const [isGooglePending, startGoogle] = useTransition();

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "", next },
  });

  async function onSubmit(values: SignInInput) {
    setFormError(null);
    const result = await signIn(values);

    if (!result.ok) {
      setFormError(result.error.message);
      // Keep the password field focused so a retry is one keystroke away.
      form.setFocus("password");
      return;
    }

    router.replace(result.data.redirectTo);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to manage your club.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      autoFocus
                      placeholder="you@club.example"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </Form>

        <div className="relative">
          <Separator />
          <span className="absolute inset-0 -top-2 mx-auto w-fit bg-card px-2 text-xs text-muted-foreground">
            or
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={isGooglePending}
          onClick={() => startGoogle(() => void signInWithGoogle(next))}
        >
          {isGooglePending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <GoogleIcon className="size-4" aria-hidden />
          )}
          Continue with Google
        </Button>
      </CardContent>

      <div className="px-6 pb-6 text-center text-sm text-muted-foreground">
        Clubs are invitation-only. Ask an administrator for an invite.
      </div>
    </Card>
  );
}
