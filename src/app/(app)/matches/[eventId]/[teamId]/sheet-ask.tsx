"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MessageCircleQuestion, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askSheetAction } from "@/server/actions/matches";

/**
 * A way to ask the reading what it thinks it saw.
 *
 * The review screen is otherwise a one-way interrogation: it asks, you answer
 * or you skip. But the useful question is often the other way round — *why*
 * does it think a basket was scored here, is that a 1 or a 7, what does this
 * line say. Without somewhere to ask, the only options are to accept a reading
 * you doubt or to abandon the import.
 *
 * The answer is advice and is treated as such: it is shown, and nothing else.
 * No transcription is revised by it and nothing is stored. The person still
 * answers the question above with their own eyes on the paper, which is the
 * same division of labour as everywhere else here — the model describes, the
 * arithmetic and the people decide.
 *
 * `situation` is written by the app rather than the reader: it carries what is
 * being disputed into the prompt, so a three-word question like "is that a 7?"
 * arrives with the context that makes it answerable.
 */
export function SheetAsk({ sheetId, situation }: { sheetId: string; situation: string }) {
  const t = useTranslations("matches");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);

  async function ask() {
    const asked = question.trim();
    if (asked.length < 2 || isAsking) return;

    setIsAsking(true);
    setError(null);
    /*
      Not cleared here: an answer that is still on screen while the next one
      is being fetched is less jarring than a box that empties and sits blank
      for twenty seconds. It is replaced when the new one lands.
    */
    const result = await askSheetAction({ sheetId, situation, question: asked });
    setIsAsking(false);

    if (result.ok) {
      setAnswer(result.data.answer);
      setQuestion("");
    } else {
      setError(result.error.message ?? t("askFailed"));
    }
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MessageCircleQuestion className="size-3.5" aria-hidden />
        {t("askTitle")}
      </p>

      <div className="flex items-end gap-2">
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("askPlaceholder")}
          aria-label={t("askTitle")}
          rows={2}
          className="min-h-0 resize-none"
          onKeyDown={(event) => {
            // Enter sends, as in any message box; a newline is still available
            // for somebody writing more than one sentence.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
        />
        <Button
          variant="secondary"
          size="icon"
          onClick={() => void ask()}
          disabled={isAsking || question.trim().length < 2}
          aria-label={t("askSend")}
        >
          {isAsking ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {answer ? (
        <div className="rounded-md border bg-muted/40 p-2.5 text-sm whitespace-pre-wrap">
          {answer}
          <p className="mt-2 text-xs text-muted-foreground">{t("askDisclaimer")}</p>
        </div>
      ) : null}
    </div>
  );
}
