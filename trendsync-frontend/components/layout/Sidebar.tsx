"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", description: "Overview & quick actions", icon: "🏠" },
  { href: "/brand-style", label: "Brand Style", description: "Visual rules editor", icon: "🎨" },
  { href: "/brand-guardian", label: "Brand Guardian", description: "Validation demo", icon: "🛡️" },
  { href: "/collection", label: "Collections", description: "Plan & generate", icon: "📦" },
  { href: "/trends", label: "Trend Intel", description: "Market insights", icon: "📈" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 neumorphic-lg flex flex-col h-screen fixed left-0 top-0 z-50 m-4 rounded-3xl overflow-hidden">
      {/* Logo */}
      <div className="p-6 border-b border-[var(--pastel-muted)]/20">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 circular-icon flex items-center justify-center">
            <span className="text-xl font-bold" style={{ color: "var(--pastel-navy)" }}>TS</span>
          </div>
          <div>
            <h1 className="font-bold text-lg" style={{ color: "var(--pastel-navy)" }}>
              TrendSync Brand Factory
            </h1>
            <p className="text-xs" style={{ color: "var(--pastel-muted)" }}>AI Fashion Studio</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-300 ${
                isActive
                  ? "neumorphic-inset"
                  : "hover:neumorphic-sm"
              }`}
              style={{ color: isActive ? "var(--pastel-navy)" : "var(--pastel-text-light)" }}
            >
              <span className="text-lg">{item.icon}</span>
              <div>
                <p className="font-semibold">{item.label}</p>
                <p className="text-xs opacity-70">{item.description}</p>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Settings */}
      <div className="p-4 border-t border-[var(--pastel-muted)]/20">
        <Link
          href="/settings"
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-300 ${
            pathname === "/settings" ? "neumorphic-inset" : "hover:neumorphic-sm"
          }`}
          style={{ color: pathname === "/settings" ? "var(--pastel-navy)" : "var(--pastel-text-light)" }}
        >
          <span className="text-lg">⚙️</span>
          <span className="font-semibold">Settings</span>
        </Link>
      </div>

      {/* User info */}
      <div className="p-4 neumorphic-inset m-4 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 circular-icon flex items-center justify-center">
            <span className="text-sm font-bold" style={{ color: "var(--pastel-navy)" }}>DU</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--pastel-navy)" }}>
              Demo User
            </p>
            <p className="text-xs truncate" style={{ color: "var(--pastel-muted)" }}>Designer</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
