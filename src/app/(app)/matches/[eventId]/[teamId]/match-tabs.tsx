"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const SetTab = createContext<(value: string) => void>(() => {});

/**
 * The match page's sections, one at a time.
 *
 * Every panel stays mounted and is only hidden. The squad sheet and the result
 * form hold unsaved drafts in component state, and Radix unmounts an inactive
 * panel by default — glancing at the box score would throw away the call-ups a
 * coach had not saved yet.
 *
 * The open tab is mirrored into `?tab=` with `replaceState` rather than a
 * navigation, so a link can open the page on the sheet without switching tabs
 * costing a server round trip.
 */
export function MatchTabs({
  initial,
  tabs,
  children,
}: {
  initial: string;
  tabs: { value: string; label: ReactNode }[];
  children: ReactNode;
}) {
  const [tab, setTab] = useState(initial);
  const root = useRef<HTMLDivElement>(null);

  function select(value: string) {
    setTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <SetTab.Provider
      value={(value) => {
        select(value);
        root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      <Tabs ref={root} value={tab} onValueChange={select} className="scroll-mt-4 gap-4">
        {/* Sideways on a phone rather than wrapping into a second row of tabs. */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList
            variant="line"
            className="h-auto! w-max min-w-full gap-1 rounded-lg border bg-card p-1 sm:min-w-0"
          >
            {tabs.map((entry) => (
              <TabsTrigger
                key={entry.value}
                value={entry.value}
                className={cn(
                  "h-9 flex-1 rounded-md px-3 after:hidden sm:flex-none",
                  // Words, not icons, at phone width: four icons is a puzzle.
                  "label-caps max-sm:[&_svg]:hidden",
                  "data-active:bg-orange-500! data-active:text-white! dark:data-active:border-transparent! dark:data-active:text-[#0b0f17]!",
                )}
              >
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {children}
      </Tabs>
    </SetTab.Provider>
  );
}

export function MatchTabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsContent value={value} forceMount className="data-[state=inactive]:hidden">
      {children}
    </TabsContent>
  );
}

/** A link elsewhere on the page that opens one of the tabs. */
export function TabLink({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const setTab = useContext(SetTab);
  return (
    <button type="button" className={className} onClick={() => setTab(value)}>
      {children}
    </button>
  );
}
