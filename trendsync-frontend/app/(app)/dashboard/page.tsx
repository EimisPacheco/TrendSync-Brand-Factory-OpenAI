"use client";

import Link from "next/link";

export default function Dashboard() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--pastel-navy)" }}>Dashboard</h1>
        <p className="mt-1" style={{ color: "var(--pastel-text-light)" }}>
          Welcome to TrendSync Brand Factory — your AI-powered fashion design studio.
        </p>
      </div>

      {/* Quick action cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[
          {
            href: "/brand-style",
            icon: "🎨",
            title: "Brand Style Editor",
            desc: "Define your brand's visual DNA — colors, camera, lighting, materials, and forbidden terms.",
            action: "Edit Brand Style",
          },
          {
            href: "/collection",
            icon: "📦",
            title: "Collection Planner",
            desc: "Generate complete fashion collections powered by trend intelligence and Gemini 3 Pro.",
            action: "Plan Collection",
          },
          {
            href: "/trends",
            icon: "📈",
            title: "Trend Intelligence",
            desc: "Real-time fashion trends from Gemini + Google Search — regional and celebrity-based.",
            action: "Explore Trends",
          },
          {
            href: "/brand-guardian",
            icon: "🛡️",
            title: "Brand Guardian",
            desc: "AI-powered validation that checks every design against your brand guidelines.",
            action: "View Validations",
          },
          {
            href: "/collection",
            icon: "📹",
            title: "Ad Video Generator",
            desc: "Create animated product advertisement videos with Veo 3.1 — storyboard to screen.",
            action: "Generate Ad",
          },
          {
            href: "/settings",
            icon: "⚙️",
            title: "Settings",
            desc: "Configure API keys, Supabase connection, and platform preferences.",
            action: "Open Settings",
          },
        ].map((card) => (
          <Link key={card.title} href={card.href}>
            <div className="neumorphic-card p-6 h-full cursor-pointer transition-all duration-300 hover:translate-y-[-2px]">
              <div className="text-3xl mb-4">{card.icon}</div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--pastel-navy)" }}>
                {card.title}
              </h3>
              <p className="text-sm mb-4" style={{ color: "var(--pastel-text-light)" }}>
                {card.desc}
              </p>
              <span className="btn-navy text-xs px-4 py-2 inline-block">{card.action}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Tech stack info */}
      <div className="neumorphic-card p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--pastel-navy)" }}>
          Powered By
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          {[
            { name: "Gemini 3 Pro", desc: "Collection planning with thinking levels" },
            { name: "Gemini 2.5 Flash", desc: "Trend intelligence + Google Search" },
            { name: "Gemini Flash Image", desc: "Product image generation" },
            { name: "Veo 3.1", desc: "Ad video generation" },
            { name: "Gemini 3 Flash", desc: "Brand Guardian visual agent" },
            { name: "Google ADK", desc: "Voice design companion" },
            { name: "Gemini Live", desc: "Real-time voice interaction" },
            { name: "Google Cloud Storage", desc: "Media storage + signed URLs" },
          ].map((tech) => (
            <div key={tech.name} className="neumorphic-inset p-3 rounded-xl">
              <p className="text-sm font-semibold" style={{ color: "var(--pastel-navy)" }}>{tech.name}</p>
              <p className="text-xs mt-1" style={{ color: "var(--pastel-muted)" }}>{tech.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
