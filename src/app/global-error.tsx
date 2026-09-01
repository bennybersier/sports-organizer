"use client";

/**
 * Last-resort boundary for errors thrown in the root layout.
 *
 * Must render its own <html>/<body>, because the normal layout never mounted —
 * which also means NextIntlClientProvider never mounted, so this is the one
 * screen in the app that cannot be translated. It is deliberately plain English
 * with inline styles: at this point neither the message catalogue nor the
 * stylesheet can be assumed to have loaded.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", lineHeight: 1.5 }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ color: "#666", marginTop: "0.5rem" }}>
          The page couldn&apos;t be loaded. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            border: "1px solid #ddd",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
