"""Standalone Voice Agent Service for Interactive Educational Cartoons.

This service runs independently with GOOGLE_CLOUD_LOCATION=us-central1
to support Gemini Live API, which requires regional endpoints.

Run with:
    export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"
    export GOOGLE_CLOUD_PROJECT=toonlabs
    export GOOGLE_CLOUD_LOCATION=us-central1
    uvicorn voice_agent_service:app --host 0.0.0.0 --port 8002 --reload
"""

import os
import json
import asyncio
import logging
import base64
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from google.adk.agents import Agent
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
VOICE_MODEL = os.environ.get("VOICE_MODEL", "gemini-live-2.5-flash-native-audio")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "toonlabs")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")

# Validate location is regional
if LOCATION == "global":
    raise ValueError(
        "Voice Agent Service requires a regional location (e.g., us-central1). "
        "Set GOOGLE_CLOUD_LOCATION to a regional endpoint."
    )

logger.info(f"[Voice Agent Service] Starting with location={LOCATION}, model={VOICE_MODEL}")

# FastAPI app
app = FastAPI(title="Voice Agent Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def evaluate_spoken_answer(branch: str, feedback_sentence: str) -> dict:
    """Tool that the voice agent calls to evaluate user's spoken answer."""
    return {"branch": branch, "feedback_sentence": feedback_sentence}


def _build_voice_instruction(
    *, 
    scene_prompt: str, 
    scene_dialogue: str,
    task: str | None = None,
    expected_response: str | None = None
) -> str:
    """Build instruction that teaches the agent to carefully evaluate answers."""
    instruction_parts = [
        "You are a Voice Reasoning Agent for an interactive educational cartoon.",
        "",
        f"The character asked: \"{scene_dialogue}\"",
        "",
    ]
    
    if task:
        instruction_parts.extend([
            "=== TASK DEFINITION ===",
            "",
            f"Task: {task}",
            "",
        ])
    
    if expected_response:
        instruction_parts.extend([
            "=== EXPECTED RESPONSE ===",
            "",
            f"What counts as correct: {expected_response}",
            "",
        ])
    
    instruction_parts.extend([
        "=== VISUAL CONTEXT ===",
        "",
        "You have been provided with a screen capture showing the current scene.",
        "The user can see this same screen and may refer to objects using spatial language.",
        "",
        "When the user uses spatial references, you MUST use the visual context:",
        "  - Positional: 'top', 'bottom', 'left', 'right', 'middle', 'center'",
        "  - Relative: 'top left', 'top right', 'bottom left', 'bottom right'",
        "  - Ordinal: 'first', 'second', 'third', 'last'",
        "  - Descriptive: 'the big one', 'the red one', 'the one on the left'",
        "",
        "Example spatial reasoning:",
        "  - User says: 'I choose the one on the top right'",
        "    → Look at the screen, identify what object is in the top-right position",
        "    → Evaluate if that object is the correct answer",
        "",
        "=== YOUR TASK ===",
        "",
        "CRITICAL: You will receive audio from the user. DO NOT evaluate immediately.",
        "WAIT until you receive an explicit message saying 'The user has finished speaking. Now evaluate their answer and call the evaluate_spoken_answer tool.'",
        "",
        "When you receive that message:",
        "1. Review what the user said (you'll have the transcription)",
        "2. Compare it to what was ACTUALLY asked in the dialogue",
        "3. Use the visual context if they referenced positions or objects spatially",
        "4. Decide if their answer is correct or incorrect",
        "5. Call evaluate_spoken_answer with your decision",
        "",
        "DO NOT call evaluate_spoken_answer until you receive the explicit 'evaluate' instruction.",
        "",
        "=== EVALUATION EXAMPLES ===",
        "",
        "Question: 'What color is the sky?'",
        "Expected: blue",
        "User says: 'blue' → CORRECT",
        "User says: 'red' → INCORRECT",
        "",
        "Question: 'Which shape is a circle?' (screen shows: triangle on left, circle on right)",
        "Expected: circle",
        "User says: 'the one on the right' → Look at screen → Right side has circle → CORRECT",
        "User says: 'the one on the left' → Look at screen → Left side has triangle → INCORRECT",
        "",
        "=== IMPORTANT NOTES ===",
        "",
        "- For pronunciation variations: Be flexible with how words SOUND (e.g., 'three' vs 'tree')",
        "- For spelling tasks: Be STRICT about letter count and sequence",
        "- For counting tasks: Be STRICT about the exact number",
        "- For spatial references: Use the visual context to resolve what they mean",
        "- Always base your decision on the TRANSCRIBED TEXT combined with VISUAL CONTEXT",
        "",
        "Call evaluate_spoken_answer with:",
        "- branch: 'correct' if the answer matches what was asked, 'incorrect' if not",
        "- feedback_sentence: A SPECIFIC sentence that:",
        "  * For CORRECT: Mentions exactly what they said and confirms it's right",
        "    Example: 'Perfect! You spelled [WORD] correctly!'",
        "    Example: 'Great! The one on the right is indeed the circle!'",
        "  * For INCORRECT: States exactly what they said AND what the mistake was",
        "    Example: 'You said [WRONG], but that has an extra [LETTER]. The correct spelling is [CORRECT].'",
        "    Example: 'You chose the one on the left, but that's a triangle. The circle is on the right.'",
        "",
        "IMPORTANT LANGUAGE RULES FOR FEEDBACK:",
        "- NEVER say 'in the picture' or 'in the image'",
        "- Instead use: 'in the scene', 'on the screen', or refer to the location naturally",
        "- Example: 'Herbivores in the scene include the rabbit and the caterpillar' (NOT 'in the picture')",
        "- Example: 'The grasshopper in the meadow is a herbivore' (NOT 'in the picture')",
        "- Be specific and natural in your language, as if you're part of the interactive scene",
    ])
    
    return "\n".join(instruction_parts)


# Create agent
agent = Agent(
    name="voice_reasoning_agent",
    model=VOICE_MODEL,
    tools=[evaluate_spoken_answer],
    instruction="You are a Voice Reasoning Agent that evaluates spoken user answers for an educational cartoon.",
    description="Evaluates spoken user answers for an educational cartoon.",
)


@app.websocket("/ws/voice-agent/{session_id}")
async def voice_agent_endpoint(websocket: WebSocket, session_id: str) -> None:
    """Bidirectional streaming endpoint for mic audio -> Gemini Live native-audio model.

    Protocol:
    - Client sends binary WebSocket frames containing PCM16 16kHz mono audio.
    - Client sends text frames with JSON control messages.
      - {"type": "start", "scenePrompt": "...", "sceneDialogue": "..."}
      - {"type": "stop"}
    - Server streams ADK events back as JSON text frames (event.model_dump_json).
    """

    logger.info("[voice_agent_service] accept session_id=%s", session_id)
    await websocket.accept()

    # Lazy singletons
    if not hasattr(voice_agent_endpoint, "_session_service"):
        voice_agent_endpoint._session_service = InMemorySessionService()  # type: ignore[attr-defined]

    if not hasattr(voice_agent_endpoint, "_runner"):
        voice_agent_endpoint._runner = Runner(  # type: ignore[attr-defined]
            app_name="treehouse-voice-agent",
            agent=agent,
            session_service=voice_agent_endpoint._session_service,  # type: ignore[attr-defined]
        )

    runner: Runner = voice_agent_endpoint._runner  # type: ignore[attr-defined]
    session_service: InMemorySessionService = voice_agent_endpoint._session_service  # type: ignore[attr-defined]

    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        session_resumption=types.SessionResumptionConfig(),
    )

    live_request_queue = LiveRequestQueue()
    user_id = "web"

    # Ensure session exists
    session = await session_service.get_session(
        app_name=runner.app_name, user_id=user_id, session_id=session_id
    )
    if not session:
        await session_service.create_session(
            app_name=runner.app_name, user_id=user_id, session_id=session_id
        )

    started = False
    scene_prompt = ""
    scene_dialogue = ""
    task = None
    expected_response = None
    session_ready = asyncio.Event()

    async def upstream_task() -> None:
        nonlocal started, scene_prompt, scene_dialogue, task, expected_response
        while True:
            try:
                message = await websocket.receive()
            except WebSocketDisconnect:
                logger.info("[voice_agent_service] upstream disconnected session_id=%s", session_id)
                return
            except RuntimeError:
                logger.info("[voice_agent_service] upstream runtime disconnect session_id=%s", session_id)
                return

            if "bytes" in message and message["bytes"] is not None:
                audio_data = message["bytes"]
                logger.info("[voice_agent_service] received audio chunk size=%d session_id=%s", len(audio_data), session_id)
                if not started:
                    logger.info("[voice_agent_service] session not started yet, skipping audio")
                    continue
                audio_blob = types.Blob(
                    mime_type="audio/pcm;rate=16000", data=audio_data
                )
                live_request_queue.send_realtime(audio_blob)
                continue

            if "text" in message and message["text"] is not None:
                logger.info(
                    "[voice_agent_service] received text session_id=%s text=%s",
                    session_id,
                    message["text"],
                )
                try:
                    payload = json.loads(message["text"])
                except Exception:
                    continue

                msg_type = payload.get("type")

                if msg_type == "start":
                    scene_prompt = str(payload.get("scenePrompt") or "")
                    scene_dialogue = str(payload.get("sceneDialogue") or "")
                    task = payload.get("task")
                    expected_response = payload.get("expectedResponse")
                    started = True
                    logger.info(
                        "[voice_agent_service] received start, storing context session_id=%s task=%s", 
                        session_id, 
                        "provided" if task else "none"
                    )
                    
                    session_ready.set()
                    
                    try:
                        await websocket.send_text(
                            json.dumps({"type": "ack", "event": "start"})
                        )
                        logger.info(
                            "[voice_agent_service] sent ack start session_id=%s", session_id
                        )
                    except Exception:
                        pass
                    continue

                if msg_type == "screen_capture":
                    logger.info(
                        "[voice_agent_service] received screen capture session_id=%s", session_id
                    )
                    try:
                        image_data_b64 = payload.get("data", "")
                        if image_data_b64:
                            image_data = base64.b64decode(image_data_b64)
                            mime_type = payload.get("mimeType", "image/jpeg")
                            
                            image_blob = types.Blob(
                                mime_type=mime_type,
                                data=image_data
                            )
                            live_request_queue.send_realtime(image_blob)
                            logger.info(
                                "[voice_agent_service] sent screen capture to model, size=%d bytes session_id=%s",
                                len(image_data),
                                session_id
                            )
                    except Exception as e:
                        logger.error(
                            "[voice_agent_service] failed to process screen capture: %s", repr(e)
                        )
                    continue

                if msg_type == "evaluate":
                    logger.info(
                        "[voice_agent_service] received evaluate signal session_id=%s", session_id
                    )
                    eval_trigger = types.Content(
                        parts=[types.Part(text="The user has finished speaking. Now evaluate their answer and call the evaluate_spoken_answer tool.")]
                    )
                    live_request_queue.send_content(eval_trigger)
                    continue

                if msg_type == "stop":
                    logger.info(
                        "[voice_agent_service] received stop session_id=%s", session_id
                    )
                    live_request_queue.close()
                    return

    async def downstream_task() -> None:
        logger.info("[voice_agent_service] downstream_task starting session_id=%s", session_id)
        try:
            await asyncio.wait_for(session_ready.wait(), timeout=10)
            logger.info("[voice_agent_service] session ready, starting live session session_id=%s", session_id)
        except Exception:
            try:
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "message": "Voice agent did not receive start context.",
                        }
                    )
                )
            except Exception:
                pass
            try:
                await websocket.close(code=1008)
            except Exception:
                pass
            return
        
        try:
            logger.info(
                "[voice_agent_service] starting run_live session_id=%s model=%s",
                session_id,
                VOICE_MODEL,
            )
            
            async def send_instruction_after_start():
                await asyncio.sleep(0.2)
                full_instruction = types.Content(
                    parts=[types.Part(text=_build_voice_instruction(
                        scene_prompt=scene_prompt,
                        scene_dialogue=scene_dialogue,
                        task=task,
                        expected_response=expected_response,
                    ))]
                )
                live_request_queue.send_content(full_instruction)
                logger.info("[voice_agent_service] sent initial instruction session_id=%s task=%s", session_id, "provided" if task else "none")
            
            asyncio.create_task(send_instruction_after_start())
            
            async for event in runner.run_live(
                user_id=user_id,
                session_id=session_id,
                live_request_queue=live_request_queue,
                run_config=run_config,
            ):
                logger.info("[voice_agent_service] received event type=%s session_id=%s", type(event).__name__, session_id)
                event_json = event.model_dump_json(exclude_none=True, by_alias=True)
                
                if "inputTranscription" in event_json:
                    event_dict = json.loads(event_json)
                    transcription_text = event_dict.get("inputTranscription", {}).get("text", "")
                    logger.info("[voice_agent_service] INPUT TRANSCRIPTION: %s", transcription_text)
                
                if "outputTranscription" in event_json:
                    event_dict = json.loads(event_json)
                    transcription_text = event_dict.get("outputTranscription", {}).get("text", "")
                    logger.info("[voice_agent_service] OUTPUT TRANSCRIPTION: %s", transcription_text)
                
                await websocket.send_text(event_json)
            logger.info("[voice_agent_service] run_live completed session_id=%s", session_id)
        except Exception as e:
            logger.exception("Voice agent live session failed")
            try:
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "message": "Voice agent live session failed.",
                            "detail": repr(e),
                        }
                    )
                )
            except Exception:
                pass
            try:
                await websocket.close(code=1011, reason="run_live failed")
            except Exception:
                pass

    try:
        await asyncio.gather(upstream_task(), downstream_task())
    except WebSocketDisconnect:
        logger.info("Voice agent client disconnected")
    finally:
        live_request_queue.close()


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "voice-agent",
        "location": LOCATION,
        "model": VOICE_MODEL,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
