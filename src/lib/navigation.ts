import {
  LayoutDashboard,
  Users,
  Package,
  Tags,
  Factory,
  FileText,
  ReceiptText,
  HandCoins,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type Role = "owner" | "admin" | "sales_rep";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see this item. Omitted = all staff. */
  roles?: Role[];
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Command Center", href: "/command-center", icon: LayoutDashboard },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Catalog", href: "/catalog", icon: Package },
  { label: "Pricing", href: "/pricing", icon: Tags },
  { label: "Purchasing", href: "/purchasing", icon: Factory, roles: ["owner", "admin"] },
  { label: "Quotes", href: "/quotes", icon: FileText },
  { label: "Orders", href: "/orders", icon: ReceiptText },
  { label: "Commissions", href: "/commissions", icon: HandCoins },
  { label: "Insights", href: "/insights", icon: BarChart3 },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    roles: ["owner", "admin"],
  },
];

export function visibleNav(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.roles || i.roles.includes(role));
}

export function roleLabel(role: Role): string {
  return {
    owner: "Owner",
    admin: "Admin",
    sales_rep: "Sales Representative",
  }[role];
}
