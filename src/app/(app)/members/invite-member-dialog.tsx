"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, Copy, Loader2, UserPlus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { inviteMemberAction } from "@/server/actions/members";

export interface RoleOption {
  id: string;
  name: string;
  rank: number;
}

/**
 * Invitation.
 *
 * The link is shown once, on success, because that is the only moment it
 * exists in plaintext — only its hash is stored. Until email delivery lands
 * this is also the only way it reaches the invitee, which the copy says
 * plainly rather than implying an email is on its way.
 */
export function InviteMemberDialog({
  roles,
  clubName,
}: {
  roles: RoleOption[];
  clubName: string;
}) {
  const router = useRouter();
  const t = useTranslations("members");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [issued, setIssued] = useState<{ link: string; accountCreated: boolean } | null>(null);

  const [email, setEmail] = useState("");
  // Default to the least privileged role, so a slip grants the least.
  const [roleId, setRoleId] = useState(roles.at(-1)?.id ?? "");
  const [message, setMessage] = useState("");

  function close() {
    setOpen(false);
    setIssued(null);
    setError(null);
    setEmail("");
    setMessage("");
    setCopied(false);
  }

  async function submit() {
    setError(null);
    setPending(true);
    const result = await inviteMemberAction({ email, roleId, message });
    setPending(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    toast.success(t("invited", { email }));
    setIssued(result.data);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          {t("invite")}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("inviteLinkTitle")}</DialogTitle>
              <DialogDescription>{t("inviteLinkBody")}</DialogDescription>
            </DialogHeader>

            {issued.accountCreated ? (
              <Alert>
                <AlertCircle aria-hidden />
                <AlertTitle>{t("accountCreated")}</AlertTitle>
              </Alert>
            ) : null}

            <div className="flex items-center gap-2">
              <Input readOnly value={issued.link} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={tCommon("copy")}
                onClick={async () => {
                  await navigator.clipboard.writeText(issued.link);
                  setCopied(true);
                  toast.success(tCommon("copied"));
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </div>

            <DialogFooter>
              <Button onClick={close}>{tCommon("done")}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("inviteTitle", { club: clubName })}</DialogTitle>
              <DialogDescription>{t("inviteBody")}</DialogDescription>
            </DialogHeader>

            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertCircle aria-hidden />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-4">
              <div className="grid gap-1">
                <Label htmlFor="invite-email">{t("email")}</Label>
                <Input
                  id="invite-email"
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="grid gap-1">
                <Label htmlFor="invite-role">{t("role")}</Label>
                <Select value={roleId} onValueChange={setRoleId}>
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1">
                <Label htmlFor="invite-message">{t("message")}</Label>
                <Textarea
                  id="invite-message"
                  rows={2}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("messageHint")}</p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={close}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={submit} disabled={pending || !email || !roleId}>
                {pending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    {tCommon("saving")}
                  </>
                ) : (
                  t("sendInvite")
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
