"use client";

import { Search } from "lucide-react";
import { CommandPalette } from "@/components/patterns/command-palette";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { type Role } from "@/lib/navigation";

export function Topbar({
  fullName,
  email,
  role,
}: {
  fullName: string;
  email: string;
  role: Role;
}) {
  // The palette owns the ⌘K listener; we render a visible trigger that opens it
  // by dispatching the same shortcut.
  const openPalette = () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true }),
    );
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur">
      <button
        onClick={openPalette}
        className="group flex h-9 w-full max-w-sm items-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/30"
      >
        <Search className="h-4 w-4" />
        <span>Search or jump to…</span>
        <kbd className="ml-auto hidden rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        <UserMenu fullName={fullName} email={email} role={role} />
      </div>

      <CommandPalette role={role} />
    </header>
  );
}
