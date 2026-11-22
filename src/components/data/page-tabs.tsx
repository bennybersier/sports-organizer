"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const SetTab = createContext<(value: string) => void>(() => {});

/**
 * A page's sections, one at a time.
 *
 * With `stackFrom="lg"` the tabs are a phone's affair only: from that width up
 * the strip is hidden and every panel shows, one under the other, because a
 * desktop has the room to show the whole page and a phone does not.
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
export function PageTabs({
  initial,
  tabs,
  stackFrom,
  children,
}: {
  initial: string;
  tabs: { value: string; label: ReactNode }[];
  /** From this width up, show every panel and no tabs. */
  stackFrom?: "lg";
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
      <Tabs
        ref={root}
        value={tab}
        onValueChange={select}
        data-stack={stackFrom}
        className="group/page-tabs scroll-mt-4 gap-4 data-[stack=lg]:lg:gap-6"
      >
        {/* Sideways on a phone rather than wrapping into a second row of tabs. */}
        <div className="-mx-4 overflow-x-auto px-4 group-data-[stack=lg]/page-tabs:lg:hidden sm:mx-0 sm:px-0">
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

export function PageTabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsContent
      value={value}
      forceMount
      className="data-[state=inactive]:hidden group-data-[stack=lg]/page-tabs:lg:block!"
    >
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
