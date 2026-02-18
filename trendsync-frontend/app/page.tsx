"use client";

import { useRouter } from "next/navigation";

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen pastel-gradient relative overflow-hidden flex items-center justify-center">
      {/* Floating orbs */}
      <div className="absolute top-0 -left-40 w-96 h-96 bg-white/30 rounded-full mix-blend-normal filter blur-3xl opacity-50 animate-float-1" />
      <div className="absolute top-40 -right-40 w-96 h-96 bg-[var(--pastel-accent)]/20 rounded-full mix-blend-normal filter blur-3xl opacity-40 animate-float-2" />
      <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-[var(--pastel-teal)]/20 rounded-full mix-blend-normal filter blur-3xl opacity-40 animate-float-3" />

      <div className="relative z-10 text-center max-w-3xl px-8">
        {/* Logo */}
        <div className="w-24 h-24 circular-icon flex items-center justify-center mx-auto mb-8">
          <span className="text-4xl font-bold" style={{ color: "var(--pastel-navy)" }}>TS</span>
        </div>

        <h1 className="text-5xl font-bold mb-4" style={{ color: "var(--pastel-navy)" }}>
          TrendSync Brand Factory
        </h1>
        <p className="text-xl mb-2" style={{ color: "var(--pastel-text-light)" }}>
          AI-Powered Fashion Design Studio
        </p>
        <p className="text-base mb-12 max-w-xl mx-auto" style={{ color: "var(--pastel-muted)" }}>
          Combine trend intelligence, brand consistency, and AI generation to create
          complete fashion collections with product images, brand validation, tech packs,
          and animated advertisement videos — all powered by Gemini and Veo.
        </p>

        <div className="flex gap-4 justify-center">
          <button
            onClick={() => router.push("/dashboard")}
            className="btn-navy text-lg px-8 py-3"
          >
            Get Started
          </button>
          <button
            onClick={() => router.push("/collection")}
            className="btn-soft text-lg px-8 py-3"
          >
            Generate Collection
          </button>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-3 gap-6 mt-16">
          {[
            { icon: "🎨", title: "Brand Style", desc: "Define visual rules for AI-consistent designs" },
            { icon: "📈", title: "Trend Intel", desc: "Real-time fashion trends via Gemini + Google Search" },
            { icon: "📹", title: "Ad Videos", desc: "Generate product ad videos with Veo 3.1" },
          ].map((f) => (
            <div key={f.title} className="neumorphic-card p-6 text-center">
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold mb-1" style={{ color: "var(--pastel-navy)" }}>{f.title}</h3>
              <p className="text-sm" style={{ color: "var(--pastel-text-light)" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
