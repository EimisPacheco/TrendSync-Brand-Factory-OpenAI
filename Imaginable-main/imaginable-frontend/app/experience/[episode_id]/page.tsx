"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import talkButtonOff from "../../../assets/images/talk_button_off_mode.png";
import talkButtonOn from "../../../assets/images/talk_button_on_mode.png";
import drawButton from "../../../assets/images/draw_button_pencil.png";
import eraserIcon from "../../../assets/images/eraser.png";

type SceneMetadata = {
  scene_number: number;
  interaction: boolean;
  prompt: string;
  dialogue: string;
  task?: string;
  expected_response?: string;
  interaction_mode?: "draw_only" | "both";
};

type Episode = {
  episode_id: string;
  title: string;
  description: string;
  scene_video_urls: string[];
  scene_feedback_urls: Array<{ correct_url: string; incorrect_url: string } | null>;
  scene_idle_urls: Array<string | null>;
  scene_metadata: SceneMetadata[];
  skills: string[];
  scene_1_url?: string;
  character_image?: string;
  character_name?: string;
};

export default function ExperiencePage() {
  const params = useParams();
  const router = useRouter();
  const episode_id = params.episode_id as string;
  
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [allEpisodes, setAllEpisodes] = useState<Episode[]>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showPlayAnimation, setShowPlayAnimation] = useState(false);
  
  // Video playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const [isEpisodeComplete, setIsEpisodeComplete] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [cumulativeTime, setCumulativeTime] = useState(0);
  const [sceneDurations, setSceneDurations] = useState<number[]>([]);
  
  // Interaction overlay state
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [isFeedbackPhase, setIsFeedbackPhase] = useState(false);
  const [currentFeedbackBranch, setCurrentFeedbackBranch] = useState<"correct" | "incorrect" | null>(null);
  const [hasTriggeredCheckpoint, setHasTriggeredCheckpoint] = useState(false);
  
  // Video source switching
  const [isPlayingFeedback, setIsPlayingFeedback] = useState(false);
  const [activeFeedbackUrl, setActiveFeedbackUrl] = useState<string | null>(null);
  const [isPlayingIdle, setIsPlayingIdle] = useState(false);
  const [activeIdleUrl, setActiveIdleUrl] = useState<string | null>(null);
  
  // Drawing state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState<string>("#ffffff");
  const dprRef = useRef(1);
  const drawingAutoSubmitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const AUTO_SUBMIT_DELAY_MS = 3000;
  
  // Voice agent state
  const [isVoiceSessionActive, setIsVoiceSessionActive] = useState(false);
  const isVoiceSessionActiveRef = useRef(false);
  const [isWaitingForVoiceEval, setIsWaitingForVoiceEval] = useState(false);
  const [voiceTranscription, setVoiceTranscription] = useState<string>("");
  const voiceWsRef = useRef<WebSocket | null>(null);
  const voiceSessionIdRef = useRef<string | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const voiceMicStreamRef = useRef<MediaStream | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  
  // Visual agent state
  const [isRunningVisualAgent, setIsRunningVisualAgent] = useState(false);
  const [visualFeedbackText, setVisualFeedbackText] = useState<string | null>(null);
  
  // Interaction mode
  const [activeAction, setActiveAction] = useState<"draw" | "talk" | null>(null);
  
  // Drawing tools state
  const [selectedColor, setSelectedColor] = useState("#FF0000");
  const [brushSize, setBrushSize] = useState(3);
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [drawingHistory, setDrawingHistory] = useState<ImageData[]>([]);

  const SCENE_DURATION_SECONDS = 4; // Approximate duration per scene

  // Fetch episode data with polling for generation status
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;
    
    const fetchEpisode = async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
        const response = await fetch(`${baseUrl}/episodes/${episode_id}`);
        if (response.ok) {
          const data = await response.json();
          
          // Check if episode is still generating
          if (data.status === "pending" || data.status === "generating") {
            console.log(`[Episode] Status: ${data.status}, polling again in 3s...`);
            setIsLoading(true);
            // Continue polling
            if (!pollInterval) {
              pollInterval = setInterval(fetchEpisode, 3000);
            }
            return;
          }
          
          // Check if generation failed
          if (data.status === "failed") {
            console.error("[Episode] Generation failed:", data.error);
            setErrorMessage(data.error || "Episode generation failed. Please try again.");
            setIsLoading(false);
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            return;
          }
          
          // Episode is complete
          console.log("[Episode] Episode ready:", data);
          setEpisode(data);
          setIsLoading(false);
          
          // Stop polling
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          
          // Initialize scene durations (will be updated when videos load)
          if (data.scene_metadata) {
            setSceneDurations(new Array(data.scene_metadata.length).fill(SCENE_DURATION_SECONDS));
          }
        }
      } catch (error) {
        console.error("Error fetching episode:", error);
        setIsLoading(false);
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }
    };

    if (episode_id) {
      setIsLoading(true);
      fetchEpisode();
    }
    
    // Cleanup on unmount
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [episode_id]);

  // Fetch all episodes for recommendations
  useEffect(() => {
    const fetchAllEpisodes = async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
        const response = await fetch(`${baseUrl}/episodes`);
        if (response.ok) {
          const data = await response.json();
          setAllEpisodes(data.episodes || []);
        }
      } catch (error) {
        console.error("Error fetching all episodes:", error);
      }
    };

    fetchAllEpisodes();
  }, []);

  // Calculate total duration
  const totalDuration = sceneDurations.reduce((sum, dur) => sum + dur, 0);

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const whole = Math.floor(seconds);
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Load video and get actual duration
  useEffect(() => {
    if (!episode || !videoRef.current) return;
    
    const video = videoRef.current;
    const newSrc = isPlayingFeedback && activeFeedbackUrl
      ? activeFeedbackUrl
      : isPlayingIdle && activeIdleUrl
      ? activeIdleUrl
      : episode.scene_video_urls[currentSceneIndex];
    
    console.log("[VIDEO SOURCE] Switching to:", newSrc, "Scene:", currentSceneIndex, "Idle:", isPlayingIdle, "Feedback:", isPlayingFeedback);
    
    video.src = newSrc;
    video.load();
    
    const handleLoadedMetadata = () => {
      console.log("[VIDEO LOADED] Duration:", video.duration, "Scene:", currentSceneIndex);
      if (video.duration && Number.isFinite(video.duration) && !isPlayingFeedback && !isPlayingIdle) {
        setSceneDurations(prev => {
          const newDurations = [...prev];
          newDurations[currentSceneIndex] = video.duration;
          return newDurations;
        });
      }
      // Auto-play idle and feedback clips
      if (isPlayingIdle || isPlayingFeedback) {
        console.log("[VIDEO LOADED] Auto-playing idle/feedback");
        video.play();
      } else if (hasStartedPlayback && !isOverlayVisible) {
        console.log("[VIDEO LOADED] Auto-playing main scene");
        video.play();
      }
    };
    
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, [currentSceneIndex, episode, hasStartedPlayback, isPlayingFeedback, isPlayingIdle, activeFeedbackUrl, activeIdleUrl, isOverlayVisible]);

  // Handle video time updates
  const handleVideoTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !episode) return;

    // Always update time for timeline display
    const currentTime = video.currentTime;
    setVideoCurrentTime(currentTime);

    // Calculate cumulative time across all scenes
    const cumulativeDuration = sceneDurations.slice(0, currentSceneIndex).reduce((sum, dur) => sum + dur, 0);
    const totalTime = cumulativeDuration + currentTime;
    setCumulativeTime(totalTime);

    // Don't check for checkpoints if already in overlay or playing feedback/idle
    if (isOverlayVisible || isPlayingFeedback || isPlayingIdle || hasTriggeredCheckpoint) return;

    // Check for interaction checkpoint
    const currentScene = episode.scene_metadata[currentSceneIndex];
    const sceneDuration = sceneDurations[currentSceneIndex] || SCENE_DURATION_SECONDS;
    const epsilon = 0.4;

    if (currentScene?.interaction && currentTime >= sceneDuration - epsilon && currentTime <= sceneDuration) {
      console.log("[CHECKPOINT] Triggering interaction at scene", currentSceneIndex);
      video.pause();
      setHasTriggeredCheckpoint(true);
      setIsOverlayVisible(true);
      setIsFeedbackPhase(false);
      
      // Clear drawing history for new checkpoint
      setDrawingHistory([]);
      
      // Switch to idle loop
      const idleUrl = episode.scene_idle_urls[currentSceneIndex];
      if (idleUrl) {
        setActiveIdleUrl(idleUrl);
        setIsPlayingIdle(true);
      }
    }
  };

  // Handle video ended
  const handleVideoEnded = () => {
    if (isPlayingFeedback && isFeedbackPhase) {
      // Feedback clip ended, switch to idle
      const idleUrl = episode?.scene_idle_urls[currentSceneIndex];
      if (idleUrl) {
        setIsPlayingFeedback(false);
        setActiveFeedbackUrl(null);
        setActiveIdleUrl(idleUrl);
        setIsPlayingIdle(true);
      }
      return;
    }

    // Move to next scene
    if (episode && currentSceneIndex < episode.scene_metadata.length - 1) {
      console.log("[VIDEO ENDED] Moving to scene", currentSceneIndex + 1);
      setCurrentSceneIndex(currentSceneIndex + 1);
      setHasTriggeredCheckpoint(false);
    } else if (episode && currentSceneIndex === episode.scene_metadata.length - 1) {
      // Episode finished
      console.log("[EPISODE] Complete!");
      setIsEpisodeComplete(true);
    }
  };

  // Start episode
  const handleStartEpisode = () => {
    setHasStartedPlayback(true);
    setIsEpisodeComplete(false);
    setCurrentSceneIndex(0);
    if (videoRef.current) {
      videoRef.current.play();
    }
  };

  // Timeline click
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!episode || !totalDuration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const targetTime = ratio * totalDuration;
    
    // Find which scene this time falls into
    let accumulatedTime = 0;
    let targetSceneIndex = 0;
    
    for (let i = 0; i < sceneDurations.length; i++) {
      if (targetTime < accumulatedTime + sceneDurations[i]) {
        targetSceneIndex = i;
        break;
      }
      accumulatedTime += sceneDurations[i];
    }
    
    const sceneTime = targetTime - accumulatedTime;
    setCurrentSceneIndex(targetSceneIndex);
    setIsOverlayVisible(false);
    setIsPlayingIdle(false);
    setIsPlayingFeedback(false);
    setHasTriggeredCheckpoint(false);
    
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = sceneTime;
      }
    }, 100);
  };

  // Finish interaction
  const handleFinishInteraction = () => {
    stopVoiceSession();
    
    const isLastScene = episode && currentSceneIndex >= episode.scene_metadata.length - 1;
    
    if (isLastScene) {
      setIsOverlayVisible(false);
      setHasStartedPlayback(false);
      setCurrentSceneIndex(0);
      setIsPlayingFeedback(false);
      setIsPlayingIdle(false);
      setActiveIdleUrl(null);
      setActiveFeedbackUrl(null);
      setIsFeedbackPhase(false);
      setCurrentFeedbackBranch(null);
      setHasTriggeredCheckpoint(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
      return;
    }

    // Move to next scene
    console.log("[FINISH INTERACTION] Moving to scene", currentSceneIndex + 1);
    setCurrentSceneIndex(currentSceneIndex + 1);
    setIsOverlayVisible(false);
    setIsFeedbackPhase(false);
    setIsPlayingFeedback(false);
    setIsPlayingIdle(false);
    setActiveIdleUrl(null);
    setActiveFeedbackUrl(null);
    setCurrentFeedbackBranch(null);
    setHasTriggeredCheckpoint(false);
  };

  // Retry interaction
  const handleRetryInteraction = () => {
    stopVoiceSession();
    
    // Clear the canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    
    setIsPlayingFeedback(false);
    setActiveFeedbackUrl(null);
    setIsPlayingIdle(false);
    setActiveIdleUrl(null);
    setIsFeedbackPhase(false);
    setIsOverlayVisible(true);
    setActiveAction("draw"); // Auto-open drawing panel
    setCurrentFeedbackBranch(null);
    setTool("pen"); // Set default tool
    setIsEraserMode(false);
    
    const idleUrl = episode?.scene_idle_urls[currentSceneIndex];
    if (idleUrl) {
      setActiveIdleUrl(idleUrl);
      setIsPlayingIdle(true);
    }
  };

  // Play feedback
  const handlePlayFeedback = (type: "correct" | "incorrect") => {
    const feedback = episode?.scene_feedback_urls[currentSceneIndex];
    if (!feedback) return;

    const url = type === "correct" ? feedback.correct_url : feedback.incorrect_url;
    if (!url) return;

    setIsOverlayVisible(true);
    setActiveAction(null);
    setIsPlayingIdle(false);
    setActiveIdleUrl(null);
    setIsPlayingFeedback(true);
    setActiveFeedbackUrl(url);
    setCurrentFeedbackBranch(type);
    setIsFeedbackPhase(true);
  };

  // Canvas setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;

      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [isOverlayVisible]);

  // Drawing handlers
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const p = getCanvasCoords(e);
    if (!p) return;

    e.currentTarget.setPointerCapture(e.pointerId);

    // Save current canvas state for undo
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setDrawingHistory(prev => [...prev, imageData]);

    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (tool === "eraser" || isEraserMode) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = brushSize * 2;
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = brushSize;
      ctx.strokeStyle = selectedColor;
    }

    setIsDrawing(true);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();

    e.currentTarget.releasePointerCapture(e.pointerId);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    ctx?.closePath();

    setIsDrawing(false);
  };

  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Save current state before clearing
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setDrawingHistory(prev => [...prev, imageData]);

    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  };

  // Visual agent interaction
  const handleInteract = async () => {
    if (activeAction === "talk") {
      console.log("[INTERACT] Sending evaluate signal to voice agent");
      await stopMicCapture();
      setIsWaitingForVoiceEval(true);
      
      if (voiceWsRef.current && voiceWsRef.current.readyState === WebSocket.OPEN) {
        voiceWsRef.current.send(JSON.stringify({ type: "evaluate" }));
      }
      return;
    }

    if (!isOverlayVisible) return;

    const videoContainer = videoContainerRef.current;
    if (!videoContainer) return;

    setIsRunningVisualAgent(true);
    setVisualFeedbackText(null);

    try {
      console.log("[VISUAL AGENT] Capturing composite screenshot...");
      
      const video = videoRef.current;
      const overlayCanvas = canvasRef.current;
      if (!video || !overlayCanvas) return;

      // Create composite canvas
      const compositeCanvas = document.createElement('canvas');
      const videoRect = video.getBoundingClientRect();
      
      // Use video's display dimensions
      compositeCanvas.width = videoRect.width;
      compositeCanvas.height = videoRect.height;
      
      const ctx = compositeCanvas.getContext('2d');
      if (!ctx) return;

      // Draw video frame
      ctx.drawImage(video, 0, 0, compositeCanvas.width, compositeCanvas.height);
      
      // Draw overlay canvas on top
      ctx.drawImage(overlayCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);

      // Convert to base64
      const base64Image = compositeCanvas.toDataURL("image/jpeg", 0.7).split(",")[1] ?? "";
      if (!base64Image) return;

      console.log("[VISUAL AGENT] Sending composite screenshot for evaluation");

      const currentScene = episode?.scene_metadata[currentSceneIndex];
      const res = await fetch("/api/visual-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          imageBase64Jpeg: base64Image, 
          sceneDialogue: currentScene?.dialogue,
          scenePrompt: currentScene?.prompt,
          task: currentScene?.task,
          expectedResponse: currentScene?.expected_response
        }),
      });

      if (!res.ok) {
        console.error("Visual agent error", await res.text());
        return;
      }

      const { branch, feedbackSentence } = await res.json();

      if (feedbackSentence) {
        setVisualFeedbackText(feedbackSentence);
      }

      if (branch === "correct" || branch === "incorrect") {
        console.log("[VISUAL AGENT] Playing feedback:", branch);
        handlePlayFeedback(branch);
      }
    } catch (err) {
      console.error("Visual agent failed", err);
    } finally {
      setIsRunningVisualAgent(false);
    }
  };

  // Voice agent helpers
  const downsampleTo16kHz = (buffer: Float32Array, inputSampleRate: number) => {
    const targetRate = 16000;
    if (inputSampleRate === targetRate) return buffer;
    const ratio = inputSampleRate / targetRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i] ?? 0;
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  };

  const floatTo16BitPCM = (input: Float32Array) => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  };

  const extractVoiceEval = (payload: unknown): { branch: "correct" | "incorrect"; feedback: string } | null => {
    const visit = (node: unknown): { branch: "correct" | "incorrect"; feedback: string } | null => {
      if (!node || typeof node !== "object") return null;

      if (Array.isArray(node)) {
        for (const item of node) {
          const res = visit(item);
          if (res) return res;
        }
        return null;
      }

      const obj = node as Record<string, unknown>;

      if (obj.name === "evaluate_spoken_answer") {
        const args = (obj.args ?? obj.arguments ?? obj) as Record<string, unknown>;
        const b = String(args.branch ?? "").toLowerCase();
        const f = String(args.feedback_sentence ?? args.feedbackSentence ?? "").trim();
        if ((b === "correct" || b === "incorrect") && f) {
          return { branch: b as "correct" | "incorrect", feedback: f };
        }
      }

      for (const key of Object.keys(obj)) {
        const res = visit(obj[key]);
        if (res) return res;
      }

      return null;
    };

    return visit(payload);
  };

  const stopMicCapture = useCallback(async () => {
    isVoiceSessionActiveRef.current = false;
    setIsVoiceSessionActive(false);

    if (voiceProcessorRef.current) {
      try {
        voiceProcessorRef.current.disconnect();
      } catch {}
      voiceProcessorRef.current.onaudioprocess = null;
      voiceProcessorRef.current = null;
    }

    if (voiceAudioContextRef.current) {
      try {
        await voiceAudioContextRef.current.close();
      } catch {}
      voiceAudioContextRef.current = null;
    }

    if (voiceMicStreamRef.current) {
      for (const track of voiceMicStreamRef.current.getTracks()) {
        track.stop();
      }
      voiceMicStreamRef.current = null;
    }
  }, []);

  const stopVoiceSession = useCallback(async () => {
    await stopMicCapture();
    setIsWaitingForVoiceEval(false);

    if (voiceWsRef.current) {
      try {
        if (voiceWsRef.current.readyState === WebSocket.OPEN) {
          voiceWsRef.current.send(JSON.stringify({ type: "stop" }));
        }
      } catch {}
      try {
        voiceWsRef.current.close();
      } catch {}
      voiceWsRef.current = null;
    }

    voiceSessionIdRef.current = null;
  }, [stopMicCapture]);

  useEffect(() => {
    return () => {
      void stopVoiceSession();
    };
  }, [stopVoiceSession]);

  const startVoiceSession = async () => {
    if (!isOverlayVisible) return;

    // Use dedicated Voice Agent Service URL
    const voiceAgentUrl = process.env.NEXT_PUBLIC_VOICE_AGENT_URL || "http://localhost:8002";
    if (!voiceAgentUrl) {
      console.error("NEXT_PUBLIC_VOICE_AGENT_URL not set");
      return;
    }

    setVisualFeedbackText(null);
    setVoiceTranscription("");

    const sessionId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    voiceSessionIdRef.current = sessionId;

    // Connect to voice agent service - convert http/https to ws/wss
    const wsProtocol = voiceAgentUrl.startsWith("https") ? "wss" : "ws";
    const wsHost = voiceAgentUrl.replace(/^https?:\/\//, "");
    const wsUrl = `${wsProtocol}://${wsHost}/ws/voice-agent/${sessionId}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    voiceWsRef.current = ws;

    let acked = false;
    let ackResolve: (() => void) | null = null;
    const ackPromise = new Promise<void>((resolve) => {
      ackResolve = resolve;
    });

    ws.onmessage = (ev) => {
      try {
        const payload = JSON.parse(String(ev.data ?? "{}"));

        if (payload.type === "error") {
          console.error("Voice WS error", payload);
          return;
        }

        if (payload.type === "ack" && payload.event === "start") {
          acked = true;
          ackResolve?.();
          return;
        }

        if (payload.inputTranscription) {
          const text = String(payload.inputTranscription.text ?? "");
          if (text) {
            setVoiceTranscription(prev => prev + " " + text);
          }
        }

        const evalRes = extractVoiceEval(payload);
        if (evalRes) {
          console.log("[VOICE AGENT] Playing feedback:", evalRes.branch);
          setVisualFeedbackText(evalRes.feedback);
          setIsWaitingForVoiceEval(false);
          handlePlayFeedback(evalRes.branch);
          
          setTimeout(() => {
            void stopVoiceSession();
          }, 500);
        }
      } catch {}
    };

    ws.onclose = () => {
      voiceWsRef.current = null;
      isVoiceSessionActiveRef.current = false;
      setIsVoiceSessionActive(false);
    };

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Voice WS failed"));
    });

    const currentScene = episode?.scene_metadata[currentSceneIndex];
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ 
      type: "start", 
      sceneDialogue: currentScene?.dialogue,
      scenePrompt: currentScene?.prompt,
      task: currentScene?.task,
      expectedResponse: currentScene?.expected_response
    }));

    try {
      await Promise.race([
        ackPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Voice ack timeout")), 3000)
        ),
      ]);
    } catch {
      void stopVoiceSession();
      return;
    }

    if (!acked) {
      void stopVoiceSession();
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceMicStreamRef.current = stream;

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContextCtor();
    voiceAudioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    voiceProcessorRef.current = processor;

    isVoiceSessionActiveRef.current = true;
    setIsVoiceSessionActive(true);

    processor.onaudioprocess = (e) => {
      const socket = voiceWsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (!isVoiceSessionActiveRef.current) return;

      const input = e.inputBuffer.getChannelData(0);
      const downsampled = downsampleTo16kHz(input, audioContext.sampleRate);
      const pcm16 = floatTo16BitPCM(downsampled);
      socket.send(pcm16.buffer);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  };

  // Determine current video source
  const currentVideoSrc = isPlayingFeedback && activeFeedbackUrl
    ? activeFeedbackUrl
    : isPlayingIdle && activeIdleUrl
    ? activeIdleUrl
    : episode?.scene_video_urls[currentSceneIndex] ?? "";

  if (errorMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="flex flex-col items-center gap-6 max-w-2xl px-8">
          <div className="text-6xl">⚠️</div>
          <p className="text-2xl font-semibold text-gray-800 text-center whitespace-pre-line" style={{ fontFamily: 'var(--font-adamina)' }}>
            {errorMessage}
          </p>
          <button
            onClick={() => router.push('/build')}
            className="mt-4 px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-full transition-colors"
            style={{ fontFamily: 'var(--font-figtree)' }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="flex flex-col items-center gap-6">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-orange-500"></div>
          <p className="text-2xl font-semibold text-gray-800 text-center max-w-md" style={{ fontFamily: 'var(--font-adamina)' }}>
            Stay tuned while we bring your personalized interactive episode to life!
          </p>
        </div>
      </div>
    );
  }

  const handleRestartEpisode = () => {
    setCurrentSceneIndex(0);
    setHasStartedPlayback(false);
    setIsEpisodeComplete(false);
    setIsOverlayVisible(false);
    setIsFeedbackPhase(false);
    setHasTriggeredCheckpoint(false);
    setIsPlayingFeedback(false);
    setActiveFeedbackUrl(null);
    setIsPlayingIdle(false);
    setActiveIdleUrl(null);
    setCumulativeTime(0);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  };

  if (!episode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Episode not found</h1>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2 bg-orange-500 text-white rounded-full hover:bg-orange-600"
          >
            Exit Episode
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col min-h-screen bg-gray-100">
      {/* Header */}
      <header className="relative z-10 w-full px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/")}
              className="text-gray-600 hover:text-gray-800"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-gray-800" style={{ fontFamily: 'var(--font-adamina)' }}>
              Exit Episode
            </h1>
          </div>
        </div>
      </header>

      {/* Video Player */}
      <main className="flex-1 flex justify-center px-8 pb-8 gap-16">
        {/* Main Content - Left Side */}
        <div className="flex flex-col justify-center w-full max-w-5xl">
        <div ref={videoContainerRef} className="relative w-full">
          <video
            ref={videoRef}
            src={currentVideoSrc}
            crossOrigin="anonymous"
            controls={false}
            loop={isPlayingIdle}
            onTimeUpdate={handleVideoTimeUpdate}
            onEnded={handleVideoEnded}
            onClick={() => {
              // Only allow play/pause when not in interaction mode
              if (!isOverlayVisible && hasStartedPlayback && !isEpisodeComplete) {
                const video = videoRef.current;
                if (video) {
                  if (video.paused) {
                    video.play();
                    setIsPaused(false);
                  } else {
                    video.pause();
                    setIsPaused(true);
                  }
                }
              }
            }}
            className="w-full rounded-2xl border border-zinc-200 bg-black aspect-video object-contain cursor-pointer"
          />

          {/* Dim Overlay Before Start */}
          {!hasStartedPlayback && !isEpisodeComplete && (
            <div className="absolute inset-0 bg-transparent rounded-lg" />
          )}

          {/* Play Button */}
          {!hasStartedPlayback && !isEpisodeComplete && (
            <button
              onClick={handleStartEpisode}
              className="absolute inset-0 m-auto flex h-32 w-32 items-center justify-center rounded-full bg-white/30 backdrop-blur-sm transition hover:bg-white/40 active:scale-95"
            >
              <svg width="56" height="56" viewBox="0 0 24 24" fill="white" className="ml-2">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
          )}

          {/* Pause Icon - Shows when video is paused during playback */}
          {hasStartedPlayback && !isEpisodeComplete && isPaused && !isOverlayVisible && (
            <div className="absolute inset-0 m-auto flex h-32 w-32 items-center justify-center rounded-full bg-white/30 backdrop-blur-sm pointer-events-none animate-fade-in">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
            </div>
          )}

          {/* Play Icon Animation - Shows briefly when resuming from pause */}
          {showPlayAnimation && !isOverlayVisible && (
            <div className="absolute inset-0 m-auto flex h-32 w-32 items-center justify-center rounded-full bg-white/30 backdrop-blur-sm pointer-events-none animate-fade-in">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="white" className="ml-2">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          )}

          {/* Episode Complete Overlay */}
          {isEpisodeComplete && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-lg">
              <div className="text-center space-y-6">
                <div className="space-y-2">
                  <p className="text-2xl font-bold text-white/90" style={{ fontFamily: 'var(--font-adamina)' }}>Awesome, you&apos;ve completed this episode!</p>
                </div>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={handleRestartEpisode}
                    className="px-8 py-3 bg-orange-500 text-white rounded-full hover:bg-orange-600 transition active:scale-95 shadow-lg"
                    style={{ fontFamily: 'var(--font-adamina)' }}
                  >
                    Restart Interactive Episode
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Interaction Overlay */}
          {isOverlayVisible && (
            <div className="pointer-events-none absolute inset-0 rounded-lg">
              <div className="relative h-full w-full">
                <canvas
                  ref={canvasRef}
                  className={`pointer-events-auto absolute inset-0 h-full w-full touch-none ${
                    isRunningVisualAgent ? "animate-pulse" : ""
                  }`}
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={handleCanvasPointerUp}
                  onPointerCancel={handleCanvasPointerUp}
                />

                {!isFeedbackPhase ? (
                  // Interaction phase
                  <div className="pointer-events-auto absolute bottom-4 left-0 right-0 flex items-center justify-between gap-5 px-6">
                    <div className="flex items-center gap-5">
                      {/* Talk Button - Only show if not draw_only mode */}
                      {episode?.scene_metadata[currentSceneIndex]?.interaction_mode !== "draw_only" && (
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            className={`flex h-24 w-24 items-center justify-center rounded-full bg-orange-700 text-white shadow-md transition hover:brightness-110 active:scale-95 p-1 ${
                              isVoiceSessionActive ? "ring-2 ring-sky-400" : ""
                            }`}
                            onClick={async () => {
                              if (isVoiceSessionActive) {
                                // Just stop the session, don't trigger evaluation
                                console.log("[TALK BUTTON] Stopping voice session");
                                await stopVoiceSession();
                                setActiveAction(null);
                              } else {
                                setActiveAction("talk");
                                try {
                                  await startVoiceSession();
                                } catch (err) {
                                  console.error("[VOICE AGENT] Failed to start:", err);
                                  setActiveAction(null);
                                  setVisualFeedbackText("Voice agent is not available. Please check that the voice agent server is running.");
                                }
                              }
                            }}
                          >
                            <Image 
                              src={isVoiceSessionActive ? talkButtonOn : talkButtonOff} 
                              alt="Talk" 
                              className={`h-20 w-20 ${isVoiceSessionActive ? 'animate-pulse' : ''}`}
                            />
                          </button>
                          <span className="rounded-md bg-white/80 px-2 py-0.5 text-[10px] font-medium text-black/80">
                            Tap to Talk
                          </span>
                        </div>
                      )}

                      {/* Draw Button */}
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (activeAction === "draw") {
                              setActiveAction(null);
                            } else {
                              setTool("pen");
                              setActiveAction("draw");
                              setIsEraserMode(false);
                            }
                          }}
                          className={`flex h-24 w-24 items-center justify-center rounded-full bg-orange-700 text-white shadow-md transition hover:brightness-110 active:scale-95 p-1 ${
                            activeAction === "draw" ? "ring-2 ring-sky-400" : ""
                          }`}
                        >
                          <Image src={drawButton} alt="Draw" className="h-20 w-20" />
                        </button>
                        <span className="rounded-md bg-white/80 px-2 py-0.5 text-[10px] font-medium text-black/80">
                          Tap to Draw
                        </span>
                      </div>

                      {/* Drawing Tools Panel */}
                      {activeAction === "draw" && (
                        <div className="pointer-events-auto bg-white/50 backdrop-blur-md rounded-2xl shadow-xl p-2.5">
                          <div className="flex items-center gap-2">
                            {/* Color Palette */}
                            <div className="flex items-center gap-1.5">
                              <div className="flex gap-1">
                                {[
                                  "#FF0000", "#FF6B00", "#FFD700", "#00FF00", "#00BFFF", "#0000FF",
                                  "#8B00FF", "#FF1493", "#000000", "#808080", "#FFFFFF", "#8B4513"
                                ].map((c) => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => {
                                      setSelectedColor(c);
                                      setColor(c);
                                      setTool("pen");
                                      setIsEraserMode(false);
                                    }}
                                    className={`h-6 w-6 rounded-md transition active:scale-95 flex-shrink-0 ${
                                      selectedColor === c && !isEraserMode ? "ring-2 ring-sky-400 scale-110" : ""
                                    } ${c === "#FFFFFF" ? "border border-gray-300" : ""}`}
                                    style={{ backgroundColor: c }}
                                  />
                                ))}
                              </div>
                            </div>

                            {/* Divider */}
                            <div className="h-6 w-px bg-gray-300 flex-shrink-0"></div>

                            {/* Brush Size */}
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <div className="text-xs font-semibold text-gray-700">
                                Size:
                              </div>
                              <input
                                type="range"
                                min="1"
                                max="20"
                                value={brushSize}
                                onChange={(e) => setBrushSize(Number(e.target.value))}
                                className="w-20 h-2 bg-black rounded-lg appearance-none cursor-pointer flex-shrink-0"
                                style={{
                                  background: `linear-gradient(to right, #000 0%, #000 ${((brushSize - 1) / 19) * 100}%, #e5e7eb ${((brushSize - 1) / 19) * 100}%, #e5e7eb 100%)`
                                }}
                              />
                            </div>

                            {/* Divider */}
                            <div className="h-6 w-px bg-gray-300 flex-shrink-0"></div>

                            {/* Tool Buttons */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setIsEraserMode(true);
                                  setTool("eraser");
                                }}
                                title="Eraser"
                                className={`flex items-center justify-center p-2 rounded-lg transition active:scale-95 ${
                                  isEraserMode
                                    ? "bg-sky-500 text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                }`}
                              >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M20 20H7L3 16l5-5 6 6"/>
                                  <path d="M12 8l5 5-5 5-5-5 5-5z"/>
                                </svg>
                              </button>
                              
                              <button
                                type="button"
                                onClick={() => {
                                  const canvas = canvasRef.current;
                                  const ctx = canvas?.getContext("2d");
                                  if (ctx && drawingHistory.length > 0) {
                                    const previousState = drawingHistory[drawingHistory.length - 1];
                                    ctx.putImageData(previousState, 0, 0);
                                    setDrawingHistory(drawingHistory.slice(0, -1));
                                  }
                                }}
                                disabled={drawingHistory.length === 0}
                                title="Undo"
                                className="p-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 7v6h6"/>
                                  <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
                                </svg>
                              </button>
                              
                              <button
                                type="button"
                                onClick={handleClearCanvas}
                                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition active:scale-95"
                              >
                                Clear
                              </button>
                            </div>

                            {/* Divider */}
                            <div className="h-8 w-px bg-gray-300 flex-shrink-0"></div>

                            {/* Done Button */}
                            <button
                              type="button"
                              onClick={async () => {
                                console.log("[DONE] Triggering drawing evaluation");
                                setActiveAction(null);
                                await handleInteract();
                              }}
                              className="px-4 py-1.5 rounded-lg bg-green-500 text-white text-xs font-bold hover:bg-green-600 transition active:scale-95 shadow-lg flex-shrink-0"
                            >
                              Done ✓
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isWaitingForVoiceEval && (
                        <span className="text-xs text-white/80 animate-pulse">Evaluating...</span>
                      )}
                    </div>
                  </div>
                ) : (
                  // Feedback phase
                  <div className="pointer-events-auto absolute bottom-4 right-4 flex flex-col items-end gap-3 px-4">
                    {visualFeedbackText && (
                      <div className="relative max-w-md rounded-3xl bg-white/80 px-8 py-5 text-lg font-semibold text-black shadow-xl backdrop-blur-sm">
                        <div className="flex items-center justify-end gap-3">
                          {episode?.character_image && (
                            <div className="flex flex-col items-center gap-1 flex-shrink-0">
                              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-white shadow-md">
                                <img
                                  src={episode.character_image}
                                  alt="Character"
                                  className="w-full h-full object-cover object-top scale-150"
                                  style={{ objectPosition: 'center 20%' }}
                                />
                              </div>
                              {episode?.character_name && (
                                <span className="text-xs font-medium text-gray-700">{episode.character_name}</span>
                              )}
                            </div>
                          )}
                          <span className="text-right">{visualFeedbackText}</span>
                        </div>
                        <div className="absolute -bottom-4 right-10 w-0 h-0 border-l-[20px] border-l-transparent border-r-[20px] border-r-transparent border-t-[20px] border-t-white/80"></div>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {currentFeedbackBranch === "incorrect" && (
                        <button
                          type="button"
                          onClick={handleRetryInteraction}
                          className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black shadow-md transition hover:bg-zinc-100 active:scale-95"
                        >
                          Retry
                        </button>
                      )}
                      <button
                        onClick={handleFinishInteraction}
                        className="rounded-full bg-orange-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-orange-700 active:scale-95"
                      >
                        Finish interaction
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="mt-4 w-full max-w-5xl">
          <div
            className="relative h-1 w-full cursor-pointer rounded-full bg-zinc-900/20"
            onClick={handleTimelineClick}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-black"
              style={{ width: totalDuration ? `${(cumulativeTime / totalDuration) * 100}%` : "0%" }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] font-medium text-zinc-500">
            <span>{formatTime(cumulativeTime)}</span>
            <span>{formatTime(totalDuration)}</span>
          </div>
        </div>

        {/* Episode Description and Skills */}
        {episode && (
          <div className="mt-6 w-full">
            <div className="rounded-xl bg-white/50 backdrop-blur-sm border border-zinc-200/50 p-5 shadow-sm">
              <div className="space-y-3">
                {/* Title with Share and Heart Buttons */}
                <div className="flex items-center justify-between">
                  <h2 className="text-3xl font-semibold text-gray-800" style={{ fontFamily: 'var(--font-adamina)' }}>
                    {episode.title}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (isLiked) {
                          setLikeCount(likeCount - 1);
                          setIsLiked(false);
                        } else {
                          setLikeCount(likeCount + 1);
                          setIsLiked(true);
                        }
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition flex-shrink-0 ${
                        isLiked 
                          ? 'bg-red-50 text-red-500' 
                          : 'bg-gray-100 text-gray-700 hover:bg-red-50 hover:text-red-500'
                      }`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                      </svg>
                      {likeCount}
                    </button>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium flex-shrink-0">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                      42
                    </div>
                    <button
                      onClick={() => {
                        setShowShareModal(true);
                        setLinkCopied(false);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition flex-shrink-0"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="18" cy="5" r="3"/>
                        <circle cx="6" cy="12" r="3"/>
                        <circle cx="18" cy="19" r="3"/>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                      </svg>
                      Share
                    </button>
                  </div>
                </div>
                
                {/* Description */}
                <p className="text-base text-zinc-700 leading-relaxed">
                  {episode.description}
                </p>
                
                {/* Skills and Interaction Modes */}
                <div className="flex items-center justify-between gap-4 pt-1">
                  {/* Skills */}
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs font-semibold text-zinc-700">Skills Learned:</span>
                    {episode.skills && episode.skills.length > 0 && episode.skills.map((skill, index) => {
                      const skillColors: { [key: string]: string } = {
                        "Math": "bg-blue-500",
                        "Spatial Reasoning": "bg-purple-500",
                        "Pattern Recognition": "bg-pink-500",
                        "Art": "bg-red-500",
                        "Color Theory": "bg-orange-500",
                        "Visual Learning": "bg-yellow-500",
                        "Counting": "bg-green-500",
                        "Problem Solving": "bg-teal-500",
                        "Science": "bg-cyan-500",
                        "Biology": "bg-emerald-500",
                        "Environmental Awareness": "bg-lime-500",
                        "Meteorology": "bg-indigo-500",
                        "Observation": "bg-violet-500",
                        "Responsible Habits": "bg-green-600",
                        "Sorting": "bg-amber-500",
                        "Early Biology": "bg-emerald-600",
                        "Scientific Thinking": "bg-blue-600",
                        "Fraction Foundations": "bg-orange-600",
                        "Part-Whole Relationships": "bg-purple-600",
                        "Visual Math": "bg-pink-600",
                      };
                      
                      // Color pool for dynamic assignment (repeating is OK)
                      const colorPool = [
                        "bg-blue-500",
                        "bg-purple-500",
                        "bg-pink-500",
                        "bg-orange-500",
                        "bg-teal-500",
                        "bg-cyan-500",
                        "bg-emerald-500",
                        "bg-lime-500",
                        "bg-indigo-500",
                        "bg-violet-500",
                        "bg-amber-500",
                        "bg-red-500",
                        "bg-green-500",
                        "bg-yellow-500",
                      ];
                      
                      // Get color from predefined map or cycle through color pool
                      const colorClass = skillColors[skill] || colorPool[index % colorPool.length];
                      
                      return (
                        <span
                          key={index}
                          className={`${colorClass} text-white px-3 py-1 rounded-full text-xs font-medium shadow-sm`}
                        >
                          {skill}
                        </span>
                      );
                    })}
                  </div>
                  
                  {/* Interaction Modes */}
                  <div className="flex gap-2 flex-shrink-0">
                    <span className="bg-zinc-800 text-white px-3 py-1 rounded-full text-xs font-medium shadow-sm flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                      </svg>
                      Voice
                    </span>
                    <span className="bg-zinc-800 text-white px-3 py-1 rounded-full text-xs font-medium shadow-sm flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                        <path d="M2 2l7.586 7.586"/>
                      </svg>
                      Drawing
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>

        {/* More to Explore - Right Side */}
        {allEpisodes.filter(ep => ep.episode_id !== episode_id).length > 0 && (
        <aside className="w-80 flex-shrink-0 self-start pt-16">
          <h2 className="text-xl font-semibold text-gray-800 mb-4" style={{ fontFamily: 'var(--font-adamina)' }}>
            More to explore
          </h2>
          <div className="space-y-4">
            {allEpisodes.length === 0 && (
              <p className="text-sm text-zinc-500">Loading recommendations...</p>
            )}
            {allEpisodes.filter(ep => ep.episode_id !== episode_id).slice(0, 6).map((ep) => (
              <div
                key={ep.episode_id}
                onClick={() => router.push(`/experience/${ep.episode_id}`)}
                className="cursor-pointer group"
              >
                <div className="flex gap-3">
                  {/* Video Thumbnail */}
                  <div className="relative w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-zinc-200">
                    <video
                      src={ep.scene_1_url}
                      preload="auto"
                      loop
                      muted
                      playsInline
                      crossOrigin="anonymous"
                      className="w-full h-full object-cover"
                      onLoadedMetadata={(e) => {
                        // Seek to a frame to ensure thumbnail shows
                        e.currentTarget.currentTime = 0.1;
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.play().catch(() => {
                          // Ignore play errors
                        });
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.pause();
                        e.currentTarget.currentTime = 0.1;
                      }}
                    />
                    {/* Black gradient overlay for less distraction */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-black/10 group-hover:opacity-0 transition-opacity pointer-events-none"></div>
                  </div>
                  
                  {/* Episode Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-800 mb-1 line-clamp-2 group-hover:text-orange-500 transition" style={{ fontFamily: 'var(--font-adamina)' }}>
                      {ep.title}
                    </h3>
                    <p className="text-xs text-zinc-600 line-clamp-2">
                      {ep.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>
        )}
      </main>

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowShareModal(false)}>
          <div className="relative bg-white rounded-2xl max-w-lg w-full p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Subtle orange glow */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-orange-500/10 via-transparent to-orange-500/5 pointer-events-none"></div>
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-orange-500/20 to-transparent blur-xl pointer-events-none"></div>
            
            {/* Content */}
            <div className="relative">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <p className="text-gray-800 text-lg font-bold" style={{ fontFamily: 'var(--font-adamina)' }}>Share this episode with anyone!</p>
                <button onClick={() => setShowShareModal(false)} className="text-gray-400 hover:text-orange-500 transition">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              {/* Link Box */}
              <div className="border border-gray-300 rounded-lg p-4 mb-4 flex items-center justify-between gap-4 bg-orange-50/30">
                <input
                  type="text"
                  value={typeof window !== 'undefined' ? window.location.href : ''}
                  readOnly
                  className="bg-transparent text-gray-600 flex-1 outline-none text-sm"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href).then(() => {
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    });
                  }}
                  className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 transition flex-shrink-0"
                >
                  {linkCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
