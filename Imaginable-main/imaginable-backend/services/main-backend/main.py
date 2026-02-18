from fastapi import FastAPI, HTTPException, WebSocket, File, UploadFile, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import base64
import time
import uuid


import sys
sys.path.append('/app')
from shared.create_episode_engine import generate_complete_episode
from shared.character_generator import generate_character_from_drawing, generate_character_from_description

from google.cloud import storage

BUCKET_NAME = "veo-video-gen-interactive-episodes"

def gcs_object_name_from_uri(uri: str) -> str:
    if uri.startswith("gs://"):
        parts = uri.replace("gs://", "").split("/", 1)
        if len(parts) == 2:
            return parts[1]
    return uri

def get_signed_url(gcs_uri: str, expiration_minutes: int = 60) -> str:
    try:
        from datetime import timedelta
        from google.oauth2 import service_account
        import os
        
        if gcs_uri.startswith('https://') or gcs_uri.startswith('http://'):
            return gcs_uri
        
        object_name = gcs_object_name_from_uri(gcs_uri)
        
        credentials_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
        
        if credentials_path and os.path.exists(credentials_path):
            credentials = service_account.Credentials.from_service_account_file(
                credentials_path,
                scopes=['https://www.googleapis.com/auth/cloud-platform']
            )
            storage_client = storage.Client(credentials=credentials)
        else:
            storage_client = storage.Client()
        
        bucket = storage_client.bucket(BUCKET_NAME)
        blob = bucket.blob(object_name)
        
        # Try to generate signed URL
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=expiration_minutes),
            method="GET"
        )
        return url
    except Exception as e:
        print(f"Error generating signed URL: {e}")
        object_name = gcs_object_name_from_uri(gcs_uri)
        return f"https://storage.googleapis.com/{BUCKET_NAME}/{object_name}"


USER_GENERATED_EPISODES = []
EPISODE_GENERATION_STATUS = {}
TRY_EXPERIENCES_EPISODES = []



app = FastAPI(title="Try Experiences API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/episodes")
async def list_episodes():
    
    episodes_list = []
    
    all_episodes = TRY_EXPERIENCES_EPISODES + USER_GENERATED_EPISODES
    
    for ep in all_episodes:
        try:
            if "thumbnail_url" in ep:
                thumbnail_signed_url = get_signed_url(ep["thumbnail_url"])
            elif ep["episode_id"] == "planet_protectors_recycling_composting":
                thumbnail_scene = ep["scenes"][4]  # Scene 5 (index 4)
                thumbnail_signed_url = get_signed_url(thumbnail_scene["video_url"])
            elif ep["episode_id"] == "ecology_explorers_photosynthesis":
                thumbnail_scene = ep["scenes"][4]  # Scene 5 (index 4)
                thumbnail_signed_url = get_signed_url(thumbnail_scene["video_url"])
            else:
                thumbnail_scene = ep["scenes"][0]  # Scene 1 (index 0)
                thumbnail_signed_url = get_signed_url(thumbnail_scene["video_url"])
            
            episodes_list.append({
                "episode_id": ep["episode_id"],
                "title": ep["title"],
                "description": ep["description"],
                "scene_count": len(ep["scenes"]),
                "interactive_scene_count": sum(1 for s in ep["scenes"] if s["interaction"]),
                "scene_1_url": thumbnail_signed_url,
                "skills": ep.get("skills", [])
            })
        except Exception as e:
            print(f"Error processing episode {ep.get('episode_id', 'unknown')}: {e}")
            continue
    
    return {"episodes": episodes_list}


@app.get("/episodes/{episode_id}")
async def get_episode(episode_id: str):

    # Check if episode is being generated
    if episode_id in EPISODE_GENERATION_STATUS:
        status_info = EPISODE_GENERATION_STATUS[episode_id]
        
        # If still generating, return status
        if status_info["status"] in ["pending", "generating"]:
            return {
                "episode_id": episode_id,
                "status": status_info["status"],
                "message": f"Episode is {status_info['status']}. Please wait...",
                "created_at": status_info["created_at"],
                "updated_at": status_info["updated_at"]
            }
        
        # If failed, return error
        if status_info["status"] == "failed":
            return {
                "episode_id": episode_id,
                "status": "failed",
                "error": status_info.get("error", "Unknown error"),
                "created_at": status_info["created_at"],
                "updated_at": status_info["updated_at"]
            }
        
    
    episode = None
    all_episodes = TRY_EXPERIENCES_EPISODES + USER_GENERATED_EPISODES
    for ep in all_episodes:
        if ep["episode_id"] == episode_id:
            episode = ep
            break
    
    if not episode:
        raise HTTPException(status_code=404, detail=f"Episode '{episode_id}' not found")
    
    # Build response with signed URLs
    scene_video_urls = []
    scene_feedback_urls = []
    scene_idle_urls = []
    scene_metadata = []
    
    for scene in episode["scenes"]:
        # Get signed URL for main scene video
        scene_video_urls.append(get_signed_url(scene["video_url"]))
        
        # Build metadata for this scene
        metadata = {
            "scene_number": scene["scene_number"],
            "interaction": scene["interaction"],
            "prompt": scene.get("prompt"),
            "dialogue": scene.get("dialogue")
        }
        
        if scene["interaction"]:
            scene_feedback_urls.append({
                "correct_url": get_signed_url(scene["correct_feedback_url"]),
                "incorrect_url": get_signed_url(scene["incorrect_feedback_url"])
            })
            scene_idle_urls.append(get_signed_url(scene["idle_url"]))
            
            metadata["task"] = scene.get("task")
            metadata["expected_response"] = scene.get("expected_response")
            metadata["interaction_mode"] = scene.get("interaction_mode", "both")
        else:
            # Non-interactive scenes have no feedback/idle
            scene_feedback_urls.append(None)
            scene_idle_urls.append(None)
        
        scene_metadata.append(metadata)
    
    return {
        "episode_id": episode["episode_id"],
        "title": episode["title"],
        "description": episode["description"],
        "skills": episode.get("skills", []),
        "stitched_video_url": scene_video_urls[0],  # For compatibility, use first scene
        "scene_video_urls": scene_video_urls,
        "scene_feedback_urls": scene_feedback_urls,
        "scene_idle_urls": scene_idle_urls,
        "scene_metadata": scene_metadata,
        "character_image": episode.get("character_image"),
        "character_name": episode.get("character_name")
    }



class GenerateEpisodeRequest(BaseModel):
    user_prompt: str
    story_style: str
    character_description: Optional[str] = None


class GenerateEpisodeResponse(BaseModel):
    success: bool
    episode: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    validation_errors: Optional[List[str]] = None


def generate_episode_background(
    episode_id: str,
    episode_topic: str,
    story_style: str,
    character_image_base64: Optional[str],
    character_description: Optional[str]
):
    try:
        print(f"[Background] Starting episode generation for {episode_id}")
        EPISODE_GENERATION_STATUS[episode_id]["status"] = "generating"
        EPISODE_GENERATION_STATUS[episode_id]["updated_at"] = time.time()
        
        # Generate the complete episode (Gemini JSON + Veo videos)
        episode_data = generate_complete_episode(
            episode_topic=episode_topic,
            story_style=story_style,
            character_image_base64=character_image_base64,
            character_description=character_description
        )
        
        # Handle case where Gemini returns a list instead of dict
        if isinstance(episode_data, list):
            if len(episode_data) > 0:
                episode_data = episode_data[0]
            else:
                raise ValueError("Episode data is an empty list")
        
        # Add metadata
        episode_data["episode_id"] = episode_id
        if character_image_base64:
            episode_data["character_image"] = f"data:image/png;base64,{character_image_base64}"
        if character_description:
            episode_data["character_name"] = character_description
        episode_data["thumbnail_url"] = episode_data.get("stitched_video_url")
        
        # Store completed episode
        USER_GENERATED_EPISODES.append(episode_data)
        EPISODE_GENERATION_STATUS[episode_id]["status"] = "complete"
        EPISODE_GENERATION_STATUS[episode_id]["data"] = episode_data
        EPISODE_GENERATION_STATUS[episode_id]["updated_at"] = time.time()
        
        print(f"[Background] Episode {episode_id} generation complete")
        
    except Exception as e:
        error_msg = str(e)
        print(f"[Background] Episode {episode_id} generation failed: {error_msg}")
        
        # User-friendly error message for frontend
        user_error_msg = "That didn't work — please try again.\nMake sure your character is original and doesn't resemble any copyrighted characters. Use kid-appropriate themes only."
        
        EPISODE_GENERATION_STATUS[episode_id]["status"] = "failed"
        EPISODE_GENERATION_STATUS[episode_id]["error"] = user_error_msg
        EPISODE_GENERATION_STATUS[episode_id]["error_details"] = error_msg  # Keep technical details for debugging
        EPISODE_GENERATION_STATUS[episode_id]["updated_at"] = time.time()


@app.post("/generate-episode", response_model=GenerateEpisodeResponse)
async def generate_episode_endpoint(
    background_tasks: BackgroundTasks,
    episode_topic: str = Form(...),
    story_style: str = Form(...),
    character_description: Optional[str] = Form(None),
    character_image: Optional[UploadFile] = File(None)
):

    try:
        episode_id = f"ep_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        
        character_image_base64 = None
        if character_image:
            image_bytes = await character_image.read()
            character_image_base64 = base64.b64encode(image_bytes).decode('utf-8')
        
        EPISODE_GENERATION_STATUS[episode_id] = {
            "status": "pending",
            "episode_id": episode_id,
            "topic": episode_topic,
            "created_at": time.time(),
            "updated_at": time.time(),
            "data": None,
            "error": None
        }
        
        background_tasks.add_task(
            generate_episode_background,
            episode_id,
            episode_topic,
            story_style,
            character_image_base64,
            character_description
        )
        
        print(f"[Generate Episode] Started background generation for {episode_id}")
        
        return GenerateEpisodeResponse(
            success=True,
            episode={
                "episode_id": episode_id,
                "status": "pending",
                "message": "Episode generation started. Poll GET /episodes/{episode_id} for status."
            }
        )
    
    except Exception as e:
        error_msg = f"Failed to start episode generation: {str(e)}"
        print(f"[Generate Episode] Error: {error_msg}")
        return GenerateEpisodeResponse(
            success=False,
            error=error_msg
        )


class GenerateCharacterRequest(BaseModel):
    character_name: Optional[str] = None
    character_description: Optional[str] = None


class GenerateCharacterResponse(BaseModel):
    success: bool
    character_image_base64: Optional[str] = None
    error: Optional[str] = None


@app.post("/generate-character", response_model=GenerateCharacterResponse)
async def generate_character_endpoint(
    character_name: Optional[str] = Form(None),
    character_description: Optional[str] = Form(None),
    drawing_image: Optional[UploadFile] = File(None)
):
    
    try:
        # Case 1: Drawing provided - convert drawing to professional character
        if drawing_image:
            print(f"[Generate Character] Processing drawing for character{f' named {character_name}' if character_name else ''}...")
            
            # Read the drawing image
            drawing_bytes = await drawing_image.read()
            drawing_base64 = base64.b64encode(drawing_bytes).decode('utf-8')
            
            # Generate character from drawing
            character_image_base64 = generate_character_from_drawing(
                drawing_base64=drawing_base64,
                character_name=character_name,
                character_description=character_description
            )
            
            print(f"[Generate Character] Successfully generated character from drawing!")
            
            return GenerateCharacterResponse(
                success=True,
                character_image_base64=character_image_base64
            )
        
        # Case 2: No drawing - generate from text description only
        elif character_name and character_description:
            print(f"[Generate Character] Generating character '{character_name}' from description...")
            
            character_image_base64 = generate_character_from_description(
                character_name=character_name,
                character_description=character_description
            )
            
            print(f"[Generate Character] Successfully generated character from description!")
            
            return GenerateCharacterResponse(
                success=True,
                character_image_base64=character_image_base64
            )
        
        # Case 3: Invalid request - need either drawing or name+description
        else:
            return GenerateCharacterResponse(
                success=False,
                error="Please provide either a drawing image OR both character name and description"
            )
    
    except Exception as e:
        error_msg = str(e)
        print(f"[Generate Character] Error: {error_msg}")
        
        # Return user-friendly error message (character_generator already provides this)
        return GenerateCharacterResponse(
            success=False,
            error=error_msg
        )
