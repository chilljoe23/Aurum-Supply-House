import { cn } from "@/lib/utils";

// Restrained wordmark — a small navy monogram tile plus the name.
export function Logo({
  className,
  collapsed,
}: {
  className?: string;
  collapsed?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
        A
      </div>
      {!collapsed && (
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-foreground">
            Aurum
          </div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Supply House
          </div>
        </div>
      )}
    </div>
  );
}
