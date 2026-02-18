"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getVoiceCompanionWsUrl } from "@/lib/api";

/**
 * Tool call result from the voice agent.
 * Each tool returns an `action` field the frontend uses to trigger UI updates.
 */
type ToolAction = {
  action: string;
  status: string;
  message?: string;
  [key: string]: unknown;
};

/**
 * Deep-scan an ADK event payload for tool call results.
 * The ADK event structure nests function calls/responses inside `content.parts`.
 */
function extractToolActions(payload: unknown): ToolAction[] {
  const actions: ToolAction[] = [];

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const obj = node as Record<string, unknown>;

    // Look for our tool action signatures
    if (typeof obj.action === "string" && typeof obj.status === "string") {
      actions.push(obj as unknown as ToolAction);
    }

    // Look for function call responses from ADK
    if (obj.name && obj.response) {
      visit(obj.response);
    }

    // Recurse into all values
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "object") visit(obj[key]);
    }
  };

  visit(payload);
  return actions;
}

export default function VoiceCompanion() {
  const router = useRouter();
  const pathname = usePathname();

  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [agentResponse, setAgentResponse] = useState("");
  const [lastAction, setLastAction] = useState<ToolAction | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isActiveRef = useRef(false);

  // ----- Handle tool actions from the voice agent -----
  const handleToolAction = useCallback(
    (action: ToolAction) => {
      console.log("[VoiceCompanion] Tool action received:", action);
      setLastAction(action);

      switch (action.action) {
        case "navigate":
          if (action.route && typeof action.route === "string") {
            console.log("[VoiceCompanion] Navigating to:", action.route);
            router.push(action.route);
          }
          break;

        case "start_collection":
          if (action.status === "started") {
            // Navigate to collection page so user can see progress
            router.push("/collection");
          }
          break;

        case "generate_ad_video":
          if (action.status === "started") {
            // Could navigate to the video tab or show notification
            console.log("[VoiceCompanion] Ad video started:", action.ad_id);
          }
          break;

        case "fetch_trend_info":
          if (action.status === "success") {
            // Navigate to trends page to show results
            router.push("/trends");
          }
          break;

        case "validate_design":
          if (action.status === "success") {
            // Navigate to brand guardian to show results
            router.push("/brand-guardian");
          }
          break;

        case "generate_variation":
          if (action.status === "success" && action.has_new_image) {
            console.log("[VoiceCompanion] New variation image generated");
          }
          break;

        case "adjust_design":
          if (action.status === "success" || action.status === "executed") {
            console.log("[VoiceCompanion] Design adjusted:", action.edit_instruction);
          }
          break;
      }
    },
    [router]
  );

  // ----- Cleanup -----
  const stopSession = useCallback(async () => {
    isActiveRef.current = false;
    setIsActive(false);
    setIsConnecting(false);

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {}
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "stop" }));
        }
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    setTranscription("");
    setAgentResponse("");
  }, []);

  useEffect(() => {
    return () => {
      void stopSession();
    };
  }, [stopSession]);

  // ----- Start session -----
  const startSession = async () => {
    setIsConnecting(true);
    setTranscription("");
    setAgentResponse("");
    setLastAction(null);
    setShowPanel(true);

    try {
      const sessionId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const wsUrl = getVoiceCompanionWsUrl(sessionId);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      // ----- Message handler: parse transcriptions + tool calls -----
      ws.onmessage = (ev) => {
        try {
          const payload = JSON.parse(String(ev.data ?? "{}"));

          // Input transcription (what user said)
          if (payload.inputTranscription?.text) {
            const text = String(payload.inputTranscription.text);
            if (text.trim()) {
              setTranscription((prev) => (prev ? prev + " " + text : text));
            }
          }

          // Output transcription (what agent said)
          if (payload.outputTranscription?.text) {
            const text = String(payload.outputTranscription.text);
            if (text.trim()) {
              setAgentResponse((prev) => (prev ? prev + " " + text : text));
            }
          }

          // Tool call results (agent executed an action)
          const actions = extractToolActions(payload);
          for (const action of actions) {
            handleToolAction(action);
          }

          // Error
          if (payload.type === "error") {
            console.error("[VoiceCompanion] Agent error:", payload.message);
            setAgentResponse(payload.message || "Voice agent encountered an error.");
          }
        } catch {}
      };

      ws.onclose = () => {
        isActiveRef.current = false;
        setIsActive(false);
        setIsConnecting(false);
      };

      ws.onerror = () => {
        setIsConnecting(false);
        setAgentResponse("Could not connect to voice companion. Make sure the backend is running on port 8002.");
      };

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => {
          reject(new Error("Voice WS failed"));
        };
      });

      // Send start with full context
      ws.send(
        JSON.stringify({
          type: "start",
          brandName: "My Brand",
          currentPage: pathname,
          // These would be injected from app state in production
          productName: null,
          productDescription: null,
          collectionName: null,
        })
      );

      // Wait for ack
      let acked = false;
      await new Promise<void>((resolve) => {
        const handler = (ev: MessageEvent) => {
          try {
            const p = JSON.parse(String(ev.data));
            if (p.type === "ack" && p.event === "start") {
              acked = true;
              ws.removeEventListener("message", handler);
              resolve();
            }
          } catch {}
        };
        ws.addEventListener("message", handler);
        setTimeout(() => {
          ws.removeEventListener("message", handler);
          resolve();
        }, 3000);
      });

      if (!acked) {
        setAgentResponse("Voice companion started but did not acknowledge. Proceeding anyway...");
      }

      // Start mic capture
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ac = new AudioContext();
      audioContextRef.current = ac;
      const source = ac.createMediaStreamSource(stream);
      const processor = ac.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      isActiveRef.current = true;
      setIsActive(true);
      setIsConnecting(false);

      processor.onaudioprocess = (e) => {
        if (
          !isActiveRef.current ||
          !wsRef.current ||
          wsRef.current.readyState !== WebSocket.OPEN
        )
          return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        wsRef.current.send(pcm16.buffer);
      };

      source.connect(processor);
      processor.connect(ac.destination);
    } catch (err) {
      console.error("[VoiceCompanion] Start failed:", err);
      setIsConnecting(false);
      setAgentResponse("Failed to start voice companion. Please check microphone permissions.");
    }
  };

  // Action badge color
  const getActionColor = (action: ToolAction | null) => {
    if (!action) return "";
    switch (action.action) {
      case "navigate":
        return "bg-blue-100 text-blue-700";
      case "fetch_trend_info":
        return "bg-purple-100 text-purple-700";
      case "validate_design":
        return action.status === "success" && (action.compliance_score as number) >= 75
          ? "bg-green-100 text-green-700"
          : "bg-amber-100 text-amber-700";
      case "generate_variation":
        return "bg-teal-100 text-teal-700";
      case "generate_ad_video":
        return "bg-pink-100 text-pink-700";
      case "start_collection":
        return "bg-indigo-100 text-indigo-700";
      case "adjust_design":
        return "bg-orange-100 text-orange-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <>
      {/* Floating voice button */}
      <button
        onClick={() => {
          if (isActive) {
            void stopSession();
            setShowPanel(false);
          } else {
            void startSession();
          }
        }}
        disabled={isConnecting}
        className={`fixed bottom-8 right-8 z-50 w-16 h-16 rounded-full shadow-lg transition-all duration-300 flex items-center justify-center ${
          isActive
            ? "bg-red-500 hover:bg-red-600 animate-pulse"
            : isConnecting
            ? "bg-gray-400 cursor-wait"
            : "btn-navy hover:scale-110"
        }`}
        title={isActive ? "Stop voice companion" : "Start voice companion"}
      >
        {isConnecting ? (
          <span className="animate-spin text-white text-xl">⏳</span>
        ) : isActive ? (
          <span className="text-white text-2xl">🎤</span>
        ) : (
          <span className="text-white text-2xl">🎙️</span>
        )}
      </button>

      {/* Voice companion panel */}
      {showPanel && (
        <div className="fixed bottom-28 right-8 z-50 w-96 neumorphic-card overflow-hidden shadow-2xl">
          {/* Header */}
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{
              background: "linear-gradient(135deg, var(--pastel-navy), var(--pastel-navy-light))",
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-white text-lg">🎙️</span>
              <div>
                <p className="text-white text-sm font-semibold">Voice Design Companion</p>
                <p className="text-white/60 text-xs">
                  {isActive ? "Listening..." : isConnecting ? "Connecting..." : "Ready"}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                if (isActive) void stopSession();
                setShowPanel(false);
              }}
              className="text-white/60 hover:text-white text-lg"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="p-4 max-h-80 overflow-y-auto space-y-3">
            {/* Active indicator */}
            {isActive && (
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--pastel-muted)" }}>
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span>Microphone active — speak naturally</span>
              </div>
            )}

            {/* User transcription */}
            {transcription && (
              <div className="neumorphic-inset p-3 rounded-xl">
                <p className="text-xs font-semibold mb-1" style={{ color: "var(--pastel-navy)" }}>
                  You said:
                </p>
                <p className="text-sm" style={{ color: "var(--pastel-text-light)" }}>
                  {transcription}
                </p>
              </div>
            )}

            {/* Agent response */}
            {agentResponse && (
              <div className="neumorphic-inset p-3 rounded-xl" style={{ borderLeft: "3px solid var(--pastel-accent)" }}>
                <p className="text-xs font-semibold mb-1" style={{ color: "var(--pastel-accent)" }}>
                  Companion:
                </p>
                <p className="text-sm" style={{ color: "var(--pastel-text)" }}>
                  {agentResponse}
                </p>
              </div>
            )}

            {/* Last tool action */}
            {lastAction && (
              <div className="neumorphic-inset p-3 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${getActionColor(lastAction)}`}
                  >
                    {lastAction.action.replace(/_/g, " ")}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      lastAction.status === "success" || lastAction.status === "started"
                        ? "bg-green-100 text-green-700"
                        : lastAction.status === "error"
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {lastAction.status}
                  </span>
                </div>
                {lastAction.message && (
                  <p className="text-xs" style={{ color: "var(--pastel-text-light)" }}>
                    {lastAction.message as string}
                  </p>
                )}
                {/* Show specific data for certain actions */}
                {lastAction.action === "fetch_trend_info" && Boolean(lastAction.trending_colors) && (
                  <p className="text-xs" style={{ color: "var(--pastel-muted)" }}>
                    {"Colors: " + String(lastAction.trending_colors)}
                  </p>
                )}
                {lastAction.action === "validate_design" && lastAction.compliance_score !== undefined && (
                  <p className="text-xs font-semibold" style={{ color: "var(--pastel-navy)" }}>
                    {"Score: " + String(lastAction.compliance_score) + "% — " + String(lastAction.badge_label)}
                  </p>
                )}
                {lastAction.action === "generate_ad_video" && Boolean(lastAction.ad_id) && (
                  <p className="text-xs font-mono" style={{ color: "var(--pastel-muted)" }}>
                    {"Video ID: " + String(lastAction.ad_id)}
                  </p>
                )}
              </div>
            )}

            {/* Hint when idle */}
            {!transcription && !agentResponse && !isActive && !isConnecting && (
              <div className="text-center py-4">
                <p className="text-sm font-semibold mb-2" style={{ color: "var(--pastel-navy)" }}>
                  Try saying:
                </p>
                <div className="space-y-1">
                  {[
                    '"What colors are trending in EU?"',
                    '"Generate a summer collection"',
                    '"Check brand compliance"',
                    '"Create an ad video for this product"',
                    '"Go to the brand editor"',
                    '"Show me this dress in silk"',
                  ].map((hint) => (
                    <p key={hint} className="text-xs italic" style={{ color: "var(--pastel-muted)" }}>
                      {hint}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer with tool badges */}
          <div
            className="px-4 py-2 border-t flex flex-wrap gap-1"
            style={{ borderColor: "var(--pastel-muted)", opacity: 0.3 }}
          >
            {["trends", "validate", "generate", "video", "navigate", "collection", "edit"].map(
              (tool) => (
                <span
                  key={tool}
                  className="text-[10px] px-2 py-0.5 rounded-full neumorphic-inset"
                  style={{ color: "var(--pastel-muted)" }}
                >
                  {tool}
                </span>
              )
            )}
          </div>
        </div>
      )}
    </>
  );
}
