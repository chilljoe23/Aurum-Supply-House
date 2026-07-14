import { type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// A glanceable metric tile. In M0 metrics render as "—" placeholders because
// no business data exists yet — the value is passed in from real queries in later
// milestones. This component never fabricates numbers.
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value?: string;
  hint?: string;
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground/70" />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
        {value ?? "—"}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
