"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import talkButtonOff from "../../assets/images/talk_button_off_mode.png";
import talkButtonOn from "../../assets/images/talk_button_on_mode.png";
import drawButton from "../../assets/images/draw_button_pencil.png";
import eraserIcon from "../../assets/images/eraser.png";
import characterRef from "../../assets/images/character_ref.png";

type SceneFeedbackUrls = {
  correct_url: string;
  incorrect_url: string;
};

export default function GeneratePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stitchedVideoUrl, setStitchedVideoUrl] = useState<string | null>(null);
  const [sceneVideoUrls, setSceneVideoUrls] = useState<string[]>([]);
  const [sceneFeedbackUrls, setSceneFeedbackUrls] = useState<SceneFeedbackUrls[]>([]);
  const [sceneIdleUrls, setSceneIdleUrls] = useState<(string | null)[]>([]);

  // Stitched video + overlay state
  const stitchedVideoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);

  // Per-scene interaction configuration (whether a scene should pause + overlay)
  const [sceneInteractionFlags, setSceneInteractionFlags] = useState<boolean[]>([]);
  const [sceneDialogues, setSceneDialogues] = useState<string[]>([]);
  const [scenePrompts, setScenePrompts] = useState<string[]>([]);
  const [sceneTasks, setSceneTasks] = useState<(string | undefined)[]>([]);
  const [sceneExpectedResponses, setSceneExpectedResponses] = useState<(string | undefined)[]>([]);

  // Custom player state
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);

  // Feedback playback state (playing per-scene correct/incorrect branch instead of stitched episode)
  const [isPlayingFeedback, setIsPlayingFeedback] = useState(false);
  const [activeFeedbackUrl, setActiveFeedbackUrl] = useState<string | null>(null);
  const [isFeedbackPhase, setIsFeedbackPhase] = useState(false);
  const [resumeSceneIndexAfterFeedback, setResumeSceneIndexAfterFeedback] =
    useState<number | null>(null);
  const [currentFeedbackBranch, setCurrentFeedbackBranch] = useState<
    "correct" | "incorrect" | null
  >(null);
  const [isPlayingIdle, setIsPlayingIdle] = useState(false);
  const [activeIdleUrl, setActiveIdleUrl] = useState<string | null>(null);
  const [isRunningVisualAgent, setIsRunningVisualAgent] = useState(false);
  const [visualFeedbackText, setVisualFeedbackText] = useState<string | null>(null);

  // Voice agent (WebSocket + mic streaming) state
  const [isVoiceSessionActive, setIsVoiceSessionActive] = useState(false);
  const isVoiceSessionActiveRef = useRef(false);
  const [isWaitingForVoiceEval, setIsWaitingForVoiceEval] = useState(false);
  const [voiceTranscription, setVoiceTranscription] = useState<string>("");
  const voiceWsRef = useRef<WebSocket | null>(null);
  const voiceSessionIdRef = useRef<string | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const voiceMicStreamRef = useRef<MediaStream | null>(null);

  // Interaction overlay mode: whether user is in draw or talk mode
  const [activeAction, setActiveAction] = useState<"draw" | "talk" | null>(null);

  // Whiteboard drawing state
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState<string>("#ffffff");
  const dprRef = useRef(1);
  const drawingAutoSubmitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const AUTO_SUBMIT_DELAY_MS = 3000; // 3 seconds after user stops drawing

  const SCENE_DURATION_SECONDS = 8; // matches backend request
  const DEFAULT_TOTAL_SCENES = 4; // historical default
  const totalScenes = sceneInteractionFlags.length || DEFAULT_TOTAL_SCENES;

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const whole = Math.floor(seconds);
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleInteract = async () => {
    // If user is in Talk mode, Interact acts as "Submit spoken answer".
    if (activeAction === "talk") {
      console.log("[INTERACT] Sending evaluate signal to voice agent");
      await stopMicCapture();
      setIsWaitingForVoiceEval(true);
      
      // Send evaluate signal to voice agent
      if (voiceWsRef.current && voiceWsRef.current.readyState === WebSocket.OPEN) {
        voiceWsRef.current.send(JSON.stringify({ type: "evaluate" }));
      }
      return;
    }

    // If user is in Draw mode, Interact acts as "Submit drawing".
    if (activeAction === "draw") {
      console.log("[INTERACT] Submitting drawing for evaluation");
      await submitDrawingForEvaluation();
      return;
    }

    // If no action is active, do nothing
    console.log("[INTERACT] No active action to submit");
  };

  const handleTalk = async () => {
    if (activeAction === "talk") {
      // Already in talk mode, stop it
      console.log("[TALK] Stopping voice session");
      await stopVoiceSession();
      setActiveAction(null);
    } else {
      // Start talk mode
      console.log("[TALK] Starting voice session");
      setActiveAction("talk");
      await startVoiceSession();
    }
  };

  const handleDraw = () => {
    if (activeAction === "draw") {
      // Already in draw mode, stop it
      console.log("[DRAW] Exiting draw mode");
      setActiveAction(null);
    } else {
      // Start draw mode
      console.log("[DRAW] Entering draw mode");
      setActiveAction("draw");
    }
  };

  const handleRetryInteraction = () => {
    console.log("[RETRY] Retrying interaction");
    setIsFeedbackPhase(false);
    setVisualFeedbackText(null);
    setCurrentFeedbackBranch(null);
    setIsPlayingFeedback(false);
    setActiveFeedbackUrl(null);

    // Play idle loop
    const idleUrl = sceneIdleUrls[currentSceneIndex];
    if (idleUrl) {
      console.log("[RETRY] Playing idle loop");
      setIsPlayingIdle(true);
      setActiveIdleUrl(idleUrl);
      if (stitchedVideoRef.current) {
        stitchedVideoRef.current.src = idleUrl;
        stitchedVideoRef.current.loop = true;
        void stitchedVideoRef.current.play();
      }
    }
  };

  const handleFinishInteraction = () => {
    console.log("[FINISH] Finishing interaction, resuming episode");
    setIsFeedbackPhase(false);
    setVisualFeedbackText(null);
    setCurrentFeedbackBranch(null);
    setIsOverlayVisible(false);
    setIsPlayingFeedback(false);
    setActiveFeedbackUrl(null);
    setIsPlayingIdle(false);
    setActiveIdleUrl(null);
    setActiveAction(null);

    // Resume stitched episode from next scene
    if (resumeSceneIndexAfterFeedback !== null && stitchedVideoRef.current) {
      const nextSceneIndex = resumeSceneIndexAfterFeedback + 1;
      setCurrentSceneIndex(nextSceneIndex);
      setResumeSceneIndexAfterFeedback(null);

      const targetTime = nextSceneIndex * SCENE_DURATION_SECONDS;
      stitchedVideoRef.current.src = stitchedVideoUrl ?? "";
      stitchedVideoRef.current.currentTime = targetTime;
      stitchedVideoRef.current.loop = false;
      void stitchedVideoRef.current.play();
    }
  };

  const submitDrawingForEvaluation = async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.error("[DRAW] No canvas found");
      return;
    }

    // Get drawing as base64
    const drawingDataUrl = canvas.toDataURL("image/png");
    const base64Data = drawingDataUrl.split(",")[1];

    console.log("[DRAW] Submitting drawing for evaluation");
    setIsRunningVisualAgent(true);

    try {
      const currentTask = sceneTasks[currentSceneIndex];
      const expectedResponse = sceneExpectedResponses[currentSceneIndex];

      const response = await fetch("http://localhost:8000/visual-agent/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: base64Data,
          task: currentTask || "Evaluate this drawing",
          expected_response: expectedResponse || "",
        }),
      });

      if (!response.ok) {
        throw new Error(`Visual agent evaluation failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log("[DRAW] Visual agent result:", result);

      const isCorrect = result.is_correct;
      const feedback = result.feedback;

      // Play appropriate feedback clip
      const feedbackUrls = sceneFeedbackUrls[currentSceneIndex];
      if (feedbackUrls) {
        const feedbackUrl = isCorrect ? feedbackUrls.correct_url : feedbackUrls.incorrect_url;
        setCurrentFeedbackBranch(isCorrect ? "correct" : "incorrect");
        setIsPlayingFeedback(true);
        setActiveFeedbackUrl(feedbackUrl);
        setResumeSceneIndexAfterFeedback(currentSceneIndex);

        if (stitchedVideoRef.current) {
          stitchedVideoRef.current.src = feedbackUrl;
          stitchedVideoRef.current.loop = false;
          void stitchedVideoRef.current.play();
        }
      }

      setVisualFeedbackText(feedback);
      setIsFeedbackPhase(true);
      setActiveAction(null);
    } catch (err) {
      console.error("[DRAW] Error evaluating drawing:", err);
      setError("Failed to evaluate drawing");
    } finally {
      setIsRunningVisualAgent(false);
    }
  };

  const startVoiceSession = async () => {
    try {
      // Generate session ID
      const sessionId = `voice_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      voiceSessionIdRef.current = sessionId;

      // Connect WebSocket to standalone voice agent service
      const ws = new WebSocket(`ws://localhost:8002/ws/voice-agent/${sessionId}`);
      voiceWsRef.current = ws;

      ws.onopen = () => {
        console.log("[VOICE] WebSocket connected");
        setIsVoiceSessionActive(true);
        isVoiceSessionActiveRef.current = true;

        // Start mic capture
        void startMicCapture();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("[VOICE] Received message:", data);

          if (data.type === "transcription") {
            setVoiceTranscription(data.text);
          } else if (data.type === "evaluation") {
            console.log("[VOICE] Evaluation result:", data);
            setIsWaitingForVoiceEval(false);

            const isCorrect = data.is_correct;
            const feedback = data.feedback;

            // Play appropriate feedback clip
            const feedbackUrls = sceneFeedbackUrls[currentSceneIndex];
            if (feedbackUrls) {
              const feedbackUrl = isCorrect ? feedbackUrls.correct_url : feedbackUrls.incorrect_url;
              setCurrentFeedbackBranch(isCorrect ? "correct" : "incorrect");
              setIsPlayingFeedback(true);
              setActiveFeedbackUrl(feedbackUrl);
              setResumeSceneIndexAfterFeedback(currentSceneIndex);

              if (stitchedVideoRef.current) {
                stitchedVideoRef.current.src = feedbackUrl;
                stitchedVideoRef.current.loop = false;
                void stitchedVideoRef.current.play();
              }
            }

            setVisualFeedbackText(feedback);
            setIsFeedbackPhase(true);
            setActiveAction(null);
            void stopVoiceSession();
          }
        } catch (err) {
          console.error("[VOICE] Error parsing message:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("[VOICE] WebSocket error:", error);
        setError("Voice session error");
      };

      ws.onclose = () => {
        console.log("[VOICE] WebSocket closed");
        setIsVoiceSessionActive(false);
        isVoiceSessionActiveRef.current = false;
      };
    } catch (err) {
      console.error("[VOICE] Error starting voice session:", err);
      setError("Failed to start voice session");
    }
  };

  const stopVoiceSession = useCallback(async () => {
    await stopMicCapture();

    if (voiceWsRef.current) {
      voiceWsRef.current.close();
      voiceWsRef.current = null;
    }

    voiceSessionIdRef.current = null;
    setIsVoiceSessionActive(false);
    isVoiceSessionActiveRef.current = false;
    setVoiceTranscription("");
    setIsWaitingForVoiceEval(false);
  }, []);

  const startMicCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceMicStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      voiceAudioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      voiceProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isVoiceSessionActiveRef.current || !voiceWsRef.current || voiceWsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        voiceWsRef.current.send(pcm16.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      console.log("[VOICE] Mic capture started");
    } catch (err) {
      console.error("[VOICE] Error starting mic capture:", err);
      setError("Failed to access microphone");
    }
  };

  const stopMicCapture = useCallback(async () => {
    if (voiceProcessorRef.current) {
      voiceProcessorRef.current.disconnect();
      voiceProcessorRef.current = null;
    }

    if (voiceAudioContextRef.current) {
      await voiceAudioContextRef.current.close();
      voiceAudioContextRef.current = null;
    }

    if (voiceMicStreamRef.current) {
      voiceMicStreamRef.current.getTracks().forEach((track) => track.stop());
      voiceMicStreamRef.current = null;
    }

    console.log("[VOICE] Mic capture stopped");
  }, []);

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);
    setStitchedVideoUrl(null);
    setSceneVideoUrls([]);
    setSceneFeedbackUrls([]);
    setSceneIdleUrls([]);
    setSceneInteractionFlags([]);
    setSceneDialogues([]);
    setScenePrompts([]);
    setSceneTasks([]);
    setSceneExpectedResponses([]);

    const baseUrl = "http://localhost:8000";

    const styleReferenceBase64 = "";

    const fullScenesPayload = [
      {
        prompt: "A friendly cartoon koala teacher in a bright classroom, standing next to a colorful poster showing different shapes (circle, square, triangle). The koala is smiling warmly and gesturing welcomingly to young learners. Vibrant, educational setting with shape-themed decorations on the walls.",
        dialogue: "Hello, little learners! Today we're going on an exciting adventure to discover the wonderful world of shapes! Shapes are all around us, and learning about them helps us understand our world better. Are you ready to explore?",
        interaction: false,
      },
      {
        prompt: "The koala teacher in the same classroom, now pointing at a large geometric circle on an easel. The circle is bright and colorful. The koala looks excited and encouraging, waiting for the learner to identify the shape.",
        dialogue: "Look at this shape! Can you tell me what shape this is? Take your time and think about it!",
        interaction: true,
        task: "The learner should identify that the shape is a circle, either by speaking the word 'circle' or drawing/pointing to a circle.",
        expected_response: "The learner says 'circle' or draws a circle shape.",
      },
      {
        prompt: "The koala teacher in a bright classroom setting, holding up a flat 2D square shape (NOT a cube). Behind the koala is a simple, clean background with NO text, NO murals, NO writing of any kind. In the scene, the koala also points to a square-shaped cheese slice on a small table. The koala looks happy and is explaining the square shape. The background should be completely plain with no visible text, labels, or decorations.",
        dialogue: "Great job! Now let's learn about another shape - the square! A square has four equal sides and four corners. See this cheese slice? It's square-shaped too!",
        interaction: false,
      },
      {
        prompt: "The koala teacher stands in front of a clean chalkboard in a bright classroom. On the chalkboard is drawn a simple square garden plot (shown as a square outline). CRITICAL: There must be NO numbers, NO labels, NO text, and NO measurements visible anywhere on or around the square garden plot. The edges of the square should be completely clean with no markings. The koala is gesturing toward the board with an encouraging expression, ready to help the learner solve a math problem.",
        dialogue: "Now here's a fun challenge! Imagine this square garden. Each side of the garden is 5 meters long. Can you figure out the total distance around the garden? That's called the perimeter!",
        interaction: true,
        task: "The learner should calculate the perimeter of a square with side length 5 meters. The correct answer is 20 meters (5 + 5 + 5 + 5 = 20).",
        expected_response: "The learner says '20' or '20 meters' or draws/writes the number 20.",
      },
      {
        prompt: "The koala teacher in the classroom, now holding up a colorful triangle shape. The triangle is bright and eye-catching. The koala looks enthusiastic and is explaining the properties of triangles to the learners.",
        dialogue: "Excellent work! Now let's explore triangles! A triangle has three sides and three corners. Triangles are very strong shapes - that's why you see them in bridges and buildings!",
        interaction: false,
      },
      {
        prompt: "The koala teacher in the classroom with a table displaying various objects: a triangular slice of pizza, a round clock, a square book, and a rectangular pencil case. The koala is gesturing toward the objects with an encouraging smile, asking the learner to identify shapes.",
        dialogue: "Let's test what you've learned! Look at these objects on the table. Can you point to or tell me which one is triangle-shaped?",
        interaction: true,
        task: "The learner should identify the triangular object, which is the slice of pizza.",
        expected_response: "The learner says 'pizza' or 'the pizza' or points to/draws the pizza slice.",
      },
      {
        prompt: "The koala teacher in the classroom, standing in front of a colorful display showing all three shapes (circle, square, triangle) with real-world examples: a clock (circle), a window (square), and a roof (triangle). The koala looks proud and happy.",
        dialogue: "You did an amazing job today! You've learned about circles, squares, and triangles. Remember, shapes are everywhere around you - in your home, at school, and outside. Keep looking for shapes wherever you go!",
        interaction: false,
      },
      {
        prompt: "The koala teacher waving goodbye in the bright, cheerful classroom. Confetti and stars are falling around the koala. The classroom has shape-themed decorations in the background. The koala has a big, warm smile and is giving a thumbs up to celebrate the learner's success.",
        dialogue: "Fantastic work, shape explorer! You're now a shapes expert! Keep practicing, and I'll see you next time for more learning adventures. Goodbye, and keep discovering the world of shapes!",
        interaction: false,
      },
    ];

    try {
      const response = await fetch(`${baseUrl}/generate-episode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: fullScenesPayload,
          duration_seconds: SCENE_DURATION_SECONDS,
          aspect_ratio: "16:9",
          generate_audio: true,
          style_reference_image_base64: styleReferenceBase64,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to generate episode: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log("[GENERATE] Episode generation started:", data);

      // Get episode_id from response
      const episodeId = data.episode?.episode_id;
      
      if (!episodeId) {
        throw new Error("No episode_id returned from server");
      }

      console.log("[GENERATE] Redirecting to episode page:", episodeId);
      
      // Redirect to episode page immediately - it will poll for status
      router.push(`/experience/${episodeId}`);
    } catch (err: any) {
      console.error("[GENERATE] Error:", err);
      setError(err.message || "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayPause = () => {
    const video = stitchedVideoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play();
      setHasStartedPlayback(true);
    } else {
      video.pause();
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = stitchedVideoRef.current;
    if (!video || !videoDuration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const fraction = clickX / rect.width;
    const newTime = fraction * videoDuration;

    video.currentTime = newTime;
    setVideoCurrentTime(newTime);

    // Determine which scene we're in
    const sceneIndex = Math.floor(newTime / SCENE_DURATION_SECONDS);
    setCurrentSceneIndex(sceneIndex);
  };

  useEffect(() => {
    const video = stitchedVideoRef.current;
    if (!video) return;

    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas || !playerContainerRef.current) return;

      const container = playerContainerRef.current;
      const rect = container.getBoundingClientRect();

      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [stitchedVideoUrl, isOverlayVisible]);

  const handleStitchedTimeUpdate: React.ReactEventHandler<HTMLVideoElement> = (e) => {
    const video = e.currentTarget;
    const currentTime = video.currentTime;
    setVideoCurrentTime(currentTime);

    // Don't check for scene transitions if we're playing feedback or idle
    if (isPlayingFeedback || isPlayingIdle) {
      return;
    }

    // Determine which scene we're in
    const sceneIndex = Math.floor(currentTime / SCENE_DURATION_SECONDS);
    if (sceneIndex !== currentSceneIndex) {
      setCurrentSceneIndex(sceneIndex);
    }

    // Check if we should pause for interaction
    const shouldInteract = sceneInteractionFlags[sceneIndex];
    if (shouldInteract && !isOverlayVisible) {
      const sceneStartTime = sceneIndex * SCENE_DURATION_SECONDS;
      const timeIntoScene = currentTime - sceneStartTime;

      // Pause at the end of the scene (just before next scene starts)
      if (timeIntoScene >= SCENE_DURATION_SECONDS - 0.1) {
        console.log(`[SCENE ${sceneIndex}] Pausing for interaction`);
        video.pause();
        setIsOverlayVisible(true);

        // Start playing idle loop
        const idleUrl = sceneIdleUrls[sceneIndex];
        if (idleUrl) {
          console.log(`[SCENE ${sceneIndex}] Playing idle loop`);
          setIsPlayingIdle(true);
          setActiveIdleUrl(idleUrl);
          video.src = idleUrl;
          video.loop = true;
          void video.play();
        }
      }
    }
  };

  const handleStitchedLoadedMetadata: React.ReactEventHandler<HTMLVideoElement> = (e) => {
    const video = e.currentTarget;
    setVideoDuration(video.duration);
  };

  const handleFeedbackEnded: React.ReactEventHandler<HTMLVideoElement> = () => {
    console.log("[FEEDBACK] Feedback clip ended, entering feedback phase");
    setIsPlayingFeedback(false);
    setActiveFeedbackUrl(null);
    // Don't auto-resume - wait for user to click Finish or Retry
  };

  // Canvas drawing handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeAction !== "draw") return;
    setIsDrawing(true);

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || activeAction !== "draw") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.lineTo(x, y);
    ctx.strokeStyle = tool === "pen" ? color : "rgba(0,0,0,0.1)";
    ctx.lineWidth = tool === "pen" ? 3 : 20;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // Reset auto-submit timer
    if (drawingAutoSubmitTimerRef.current) {
      clearTimeout(drawingAutoSubmitTimerRef.current);
    }
    drawingAutoSubmitTimerRef.current = setTimeout(() => {
      console.log("[DRAW] Auto-submitting after inactivity");
      void submitDrawingForEvaluation();
    }, AUTO_SUBMIT_DELAY_MS);
  };

  const handleCanvasMouseUp = () => {
    setIsDrawing(false);
  };

  const handleCanvasMouseLeave = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width / dprRef.current, canvas.height / dprRef.current);
  };

  useEffect(() => {
    return () => {
      void stopVoiceSession();
    };
  }, [stopVoiceSession]);

  return (
    <div className="relative flex flex-col min-h-screen bg-gray-100 font-sans dark:bg-black">
      <header className="absolute left-9 top-3 right-8 z-10">
        <div className="w-full rounded-lg border border-[#2F2F2F] bg-transparent px-3 py-2.5">
          <div className="flex items-center gap-12">
            <img
              src="/wonder.png"
              alt="Wonder logo"
              className="block"
              style={{ width: 270, height: "auto" }}
            />
            <nav className="ml-100 flex items-center gap-10">
              <Link href="/">
                <button
                  type="button"
                  className="snow-btn rounded-md border border-zinc-400 bg-[#2F2F2F] px-2 py-0.5 font-[var(--font-figtree)] text-[14px] font-normal text-white transition-colors hover:bg-zinc-50 hover:text-black"
                >
                  Experiences
                </button>
              </Link>
              <Link href="/build">
                <button
                  type="button"
                  className="snow-btn rounded-md border border-zinc-400 bg-[#2F2F2F] px-2 py-0.5 font-[var(--font-figtree)] text-[14px] font-normal text-white transition-colors hover:bg-zinc-50 hover:text-black"
                >
                  Create Your Own Episode
                </button>
              </Link>
              <Link href="/generate">
                <button
                  type="button"
                  className="snow-btn rounded-md border border-[#0b286cd4] bg-zinc-50 px-2 py-0.5 font-[var(--font-figtree)] text-[14px] font-normal text-black transition-colors hover:bg-[#2F2F2F] hover:text-white"
                >
                  Generate Episode
                </button>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="flex w-full max-w-6xl mx-auto flex-col items-center gap-8 px-4 py-16 pt-24 text-center text-black dark:text-zinc-50">
        <h1 className="text-3xl font-semibold tracking-tight">Generate Interactive Episode</h1>

        <p className="max-w-md text-zinc-600 dark:text-zinc-400">
          Click the button below to generate a stitched episode and see each individual scene as its own clip.
        </p>

        <button
          onClick={handleGenerate}
          disabled={isLoading}
          className="rounded-full bg-black px-8 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-600 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {isLoading ? "Generating..." : "Generate"}
        </button>

        {error && <p className="mt-4 max-w-md text-sm text-red-500">{error}</p>}

        {stitchedVideoUrl && (
          <section className="mt-8 flex w-full flex-col items-center gap-4">
            <h2 className="text-xl font-medium">Stitched Episode</h2>
            <div ref={playerContainerRef} className="relative w-full max-w-5xl">
              <video
                ref={stitchedVideoRef}
                src={
                  isPlayingFeedback && activeFeedbackUrl
                    ? activeFeedbackUrl
                    : isPlayingIdle && activeIdleUrl
                      ? activeIdleUrl
                      : stitchedVideoUrl ?? undefined
                }
                crossOrigin="anonymous"
                controls={false}
                loop={isPlayingIdle}
                onTimeUpdate={handleStitchedTimeUpdate}
                onLoadedMetadata={handleStitchedLoadedMetadata}
                onEnded={isPlayingFeedback ? handleFeedbackEnded : undefined}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800"
              />

              {hasStartedPlayback && (
                <button
                  onClick={handlePlayPause}
                  className="absolute bottom-4 left-4 rounded-full bg-black/80 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-black active:scale-95"
                >
                  {stitchedVideoRef.current?.paused ? "Play" : "Pause"}
                </button>
              )}

              {isOverlayVisible && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <canvas
                    ref={canvasRef}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseLeave}
                    className={`pointer-events-auto absolute inset-0 ${activeAction === "draw" ? "cursor-crosshair" : "cursor-default"}`}
                    style={{
                      backgroundColor: activeAction === "draw" ? "rgba(0,0,0,0.3)" : "transparent",
                    }}
                  />

                  <div className="pointer-events-auto absolute bottom-4 left-4 flex flex-col gap-2">
                    {!isFeedbackPhase && (
                      <>
                        <button
                          type="button"
                          onClick={handleInteract}
                          disabled={!activeAction || isRunningVisualAgent || isWaitingForVoiceEval}
                          className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black shadow-md transition hover:bg-zinc-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRunningVisualAgent || isWaitingForVoiceEval ? "Evaluating..." : "Interact"}
                        </button>
                        <button
                          type="button"
                          onClick={handleTalk}
                          className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-md transition active:scale-95 ${
                            activeAction === "talk"
                              ? "bg-red-500 text-white hover:bg-red-600"
                              : "bg-white text-black hover:bg-zinc-100"
                          }`}
                        >
                          <Image 
                            src={activeAction === "talk" ? talkButtonOn : talkButtonOff} 
                            alt="Talk" 
                            width={16} 
                            height={16}
                            className={activeAction === "talk" ? 'animate-pulse' : ''}
                          />
                          {activeAction === "talk" ? "Stop Talking" : "Talk"}
                        </button>
                        <button
                          type="button"
                          onClick={handleDraw}
                          className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-md transition active:scale-95 ${
                            activeAction === "draw"
                              ? "bg-blue-500 text-white hover:bg-blue-600"
                              : "bg-white text-black hover:bg-zinc-100"
                          }`}
                        >
                          <Image src={drawButton} alt="Draw" width={16} height={16} />
                          {activeAction === "draw" ? "Stop Drawing" : "Draw"}
                        </button>
                        {activeAction === "draw" && (
                          <button
                            type="button"
                            onClick={clearCanvas}
                            className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black shadow-md transition hover:bg-zinc-100 active:scale-95"
                          >
                            <Image src={eraserIcon} alt="Clear" width={16} height={16} />
                            Clear
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  <div className="pointer-events-auto absolute top-4 left-4 right-4">
                    {!isFeedbackPhase ? (
                      <div className="rounded-3xl bg-white/95 px-6 py-4 text-left text-sm font-semibold text-black shadow-xl">
                        <div className="mb-2">
                          <strong>Scene {currentSceneIndex + 1}:</strong> {sceneDialogues[currentSceneIndex]}
                        </div>
                        {sceneTasks[currentSceneIndex] && (
                          <div className="text-xs text-zinc-600">
                            <strong>Task:</strong> {sceneTasks[currentSceneIndex]}
                          </div>
                        )}
                        <div className="mt-3 flex items-center gap-2">
                          {/* <button
                            type="button"
                            onClick={() => void stopVoiceSession()}
                            disabled={!isVoiceSessionActive}
                            className="rounded-md bg-red-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-red-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Stop Voice
                          </button> */}
                          {isWaitingForVoiceEval && (
                            <span className="text-xs text-white/80 animate-pulse">Evaluating...</span>
                          )}
                          {voiceTranscription && (
                            <div className="mt-2 rounded-md bg-black/80 px-3 py-2 text-xs text-white/90">
                              <div className="font-semibold mb-1">You said:</div>
                              <div>{voiceTranscription}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="pointer-events-auto absolute bottom-4 right-4 flex flex-col items-end gap-3 px-4">
                        {visualFeedbackText && (
                          <div className="relative max-w-sm rounded-3xl bg-white/95 px-6 py-4 text-sm font-semibold text-black text-right shadow-xl">
                            {visualFeedbackText}
                            <div className="absolute -bottom-3 right-8 w-0 h-0 border-l-[16px] border-l-transparent border-r-[16px] border-r-transparent border-t-[16px] border-t-white/95"></div>
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
                            type="button"
                            onClick={handleFinishInteraction}
                            className="rounded-full bg-black px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-zinc-900 active:scale-95"
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

            {stitchedVideoUrl && (
              <div className="mt-4 w-full max-w-5xl text-left">
                <div
                  className="relative h-1 w-full cursor-pointer rounded-full bg-zinc-900/20 dark:bg-zinc-100/10"
                  onClick={handleTimelineClick}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-sky-500"
                    style={{ width: videoDuration ? `${(videoCurrentTime / videoDuration) * 100}%` : "0%" }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                  <span>{formatTime(videoCurrentTime)}</span>
                  <span>{formatTime(videoDuration)}</span>
                </div>
              </div>
            )}
          </section>
        )}

        {sceneVideoUrls.length > 0 && (
          <section className="mt-8 flex w-full flex-col items-center gap-4">
            <h2 className="text-lg font-medium">Individual Scenes</h2>
            <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
              {sceneVideoUrls.map((url, index) => {
                const feedback = sceneFeedbackUrls[index];
                return (
                  <div key={url} className="flex flex-col items-center gap-3">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">Scene {index + 1}</p>
                    <video src={url} controls className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800" />
                    {feedback && (
                      <div className="grid w-full grid-cols-2 gap-2 text-xs">
                        <div className="flex flex-col items-center gap-1">
                          <p className="text-zinc-600 dark:text-zinc-400">Correct</p>
                          <video
                            src={feedback.correct_url}
                            controls
                            className="w-full rounded-md border border-zinc-200 dark:border-zinc-800"
                          />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <p className="text-zinc-600 dark:text-zinc-400">Incorrect</p>
                          <video
                            src={feedback.incorrect_url}
                            controls
                            className="w-full rounded-md border border-zinc-200 dark:border-zinc-800"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
