"""
Create Your Own Episode Engine
Uses Gemini 3 Pro with thinking levels to orchestrate episode generation.
"""

import json
import os
import requests
from typing import Dict, List, Any, Optional
from google import genai
from google.genai import types
import base64

GEMINI_3_MODEL = "gemini-3-pro-preview"
MAX_VALIDATION_RETRIES = 3

REQUIRED_SCENE_COUNT = 8
INTERACTIVE_SCENE_INDICES = {2, 4, 6}
NON_INTERACTIVE_SCENE_INDICES = {1, 3, 5, 7, 8}

VEO_GENERATION_ENDPOINT = os.getenv("VEO_GENERATION_ENDPOINT", "https://veo-service-528610678511.us-central1.run.app/generate-episode")


def validate_episode_schema(episode_data: Dict[str, Any]) -> tuple[bool, List[str]]:
    """
    Validates that the episode JSON matches the required schema.
    Returns (is_valid, list_of_errors).
    """
    errors = []
    
    # Check required top-level fields
    required_fields = ["episode_id", "title", "description", "skills", "scenes"]
    for field in required_fields:
        if field not in episode_data:
            errors.append(f"Missing required field: {field}")
    
    # Check scenes
    if "scenes" not in episode_data:
        errors.append("Missing 'scenes' field")
        return False, errors
    
    scenes = episode_data["scenes"]
    
    # Check scene count
    if len(scenes) != REQUIRED_SCENE_COUNT:
        errors.append(f"Expected {REQUIRED_SCENE_COUNT} scenes, got {len(scenes)}")
    
    # Validate each scene
    for i, scene in enumerate(scenes, start=1):
        scene_num = scene.get("scene_number", i)
        
        # Check required fields for all scenes
        required_scene_fields = ["scene_number", "interaction", "video_url", "prompt", "dialogue"]
        for field in required_scene_fields:
            if field not in scene:
                errors.append(f"Scene {scene_num}: Missing required field '{field}'")
        
        # Check interaction flag
        is_interactive = scene.get("interaction", False)
        should_be_interactive = scene_num in INTERACTIVE_SCENE_INDICES
        
        if is_interactive != should_be_interactive:
            errors.append(
                f"Scene {scene_num}: interaction should be {should_be_interactive}, got {is_interactive}"
            )
        
        # Validate interactive scenes have required fields
        if is_interactive:
            interactive_fields = [
                "interaction_mode", "task", "expected_response",
                "correct_feedback_url", "incorrect_feedback_url", "idle_url"
            ]
            for field in interactive_fields:
                if field not in scene:
                    errors.append(f"Scene {scene_num}: Interactive scene missing '{field}'")
        
        # Validate non-interactive scenes don't have interaction-only fields
        if not is_interactive:
            forbidden_fields = [
                "interaction_mode", "task", "expected_response",
                "correct_feedback_url", "incorrect_feedback_url", "idle_url"
            ]
            for field in forbidden_fields:
                if field in scene:
                    errors.append(
                        f"Scene {scene_num}: Non-interactive scene should not have '{field}'"
                    )
    
    return len(errors) == 0, errors


def get_gemini_client() -> genai.Client:
    """Initialize and return Gemini client with Vertex AI authentication."""
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "toonlabs")
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "global")
    
    return genai.Client(
        vertexai=True,
        project=project_id,
        location=location
    )


def generate_episode_plan(
    client: genai.Client,
    episode_topic: str,
    story_style: str,
    character_description: Optional[str] = None
) -> Dict[str, Any]:
    """
    Phase A: Generate complete episode plan using HIGH thinking level.
    Returns a structured episode outline with all 8 scenes.
    """
    
    reference_episode = '''
{
  "episode_id": "ecology_explorers_photosynthesis",
  "title": "Lumi's Nature Lab: How Plants Make Food!",
  "description": "Join Lumi the Bunny in an outdoor ecology learning lab to uncover the three key ingredients plants use to make food — and the oxygen they share with the world.",
  "skills": ["Early Biology", "Scientific Thinking"],
  "scenes": [
    {
      "scene_number": 1,
      "interaction": false,
      "video_url": "gs://placeholder/scene1.mp4",
      "prompt": "Cinematic 2D storybook-style outdoor ecology learning lab. Include a wooden field table, plant pots, magnifying glass, and subtle observation tools with NO readable text. Foreground features one clearly drooping plant with pale leaves. Lumi the Bunny kneels beside it, gently lifting a leaf with concern. Warm morning sunlight, soft shadows, strong depth.",
      "dialogue": "Oh no… this little plant is tired. Have you ever wondered how plants make their food?"
    },
    {
      "scene_number": 2,
      "interaction": true,
      "interaction_mode": "draw",
      "video_url": "gs://placeholder/scene2.mp4",
      "correct_feedback_url": "gs://placeholder/scene2_correct.mp4",
      "incorrect_feedback_url": "gs://placeholder/scene2_incorrect.mp4",
      "idle_url": "gs://placeholder/scene2_idle.mp4",
      "prompt": "Same outdoor ecology lab. Lumi stands beside a LARGE BLANK WHITE DRAWING BOARD positioned clearly toward the viewer. The board must be completely empty with generous drawing space. Background greenery is softly blurred. Lighting is bright and inviting. No readable text anywhere.",
      "dialogue": "Plants need sunlight! Can you draw a bright sun in the sky to help our plant?",
      "task": "Draw a sun with rays on the blank board.",
      "expected_response": "A circular shape with lines radiating outward, representing a sun."
    }
  ]
}
'''
    
    # Build the prompt for episode planning
    planning_prompt = f"""
You are an expert educational content designer creating interactive episodes for children.

USER REQUEST:
- Episode Topic: {episode_topic}
- Story Style: {story_style}
{f"- Character: {character_description}" if character_description else ""}

REFERENCE EPISODE (for schema and style guidance):
{reference_episode}

CRITICAL REQUIREMENTS:
You must generate a complete episode JSON that follows this EXACT structure and rules:

1. CHARACTER CONSISTENCY (CRITICAL - MUST FOLLOW):
   ⚠️ ONLY ONE CHARACTER: The character from the reference image is the ONLY character in the entire episode
   - NO other characters should appear in any scene - NOT EVEN IN THE BACKGROUND
   - NO other characters should speak or be mentioned
   - NO new characters should be introduced in later scenes
   - NO friends, companions, helpers, or background characters of any kind
   - This character is the sole guide, teacher, and companion throughout
   - All prompts must feature ONLY this character
   - All dialogue is spoken by ONLY this character
   - The character is ALWAYS ALONE in every single scene
   
   ⚠️ EPISODE DESCRIPTION FORMAT:
   - Use the character's NAME (not their species/type)
   - Focus on WHAT the lesson teaches, not WHO the character is
   - Format: "[Character Name] explores [lesson topic]" or "[Character Name] discovers [concept]"
   - Example: "Lumi explores how plants make food through photosynthesis"
   - NOT: "Join Lumi the Bunny in learning about..." (avoid mentioning species)

2. EPISODE STRUCTURE (NON-NEGOTIABLE):
   - Exactly 8 scenes
   - Scenes 2, 4, and 6 have interaction checkpoints
   - Scenes 1, 3, 5, 7, and 8 are non-interactive

2. SCENE PURPOSE BY INDEX:
   - Scene 1: Introduce the main concept (non-interactive)
   - Scene 2: First interaction checkpoint (INTERACTIVE)
   - Scene 3: Deepen understanding (non-interactive)
   - Scene 4: Second interaction checkpoint (INTERACTIVE)
   - Scene 5: Expand the concept (non-interactive)
   - Scene 6: Third interaction checkpoint (INTERACTIVE)
   - Scene 7: Connect to real-world application (non-interactive)
   - Scene 8: Celebrate learning and recap (non-interactive)

3. REQUIRED JSON SCHEMA:
{{
  "episode_id": "unique_id_based_on_content",
  "title": "Episode Title",
  "description": "Brief description of the episode",
  "skills": ["Skill1", "Skill2", "Skill3"],
  "scenes": [
    {{
      "scene_number": 1,
      "interaction": false,
      "video_url": "gs://placeholder/scene1.mp4",
      "prompt": "Detailed Veo video generation prompt for this scene",
      "dialogue": "What the character says in this scene"
    }},
    {{
      "scene_number": 2,
      "interaction": true,
      "interaction_mode": "draw_only" or "voice_only" or "both",
      "video_url": "gs://placeholder/scene2.mp4",
      "correct_feedback_url": "gs://placeholder/scene2_correct.mp4",
      "incorrect_feedback_url": "gs://placeholder/scene2_incorrect.mp4",
      "idle_url": "gs://placeholder/scene2_idle.mp4",
      "prompt": "Detailed Veo video generation prompt",
      "dialogue": "What the character asks/says",
      "task": "Clear description of what the child needs to do",
      "expected_response": "What constitutes a correct answer"
    }},
    ... (continue for all 8 scenes)
  ]
}}

4. DIALOGUE REQUIREMENTS (CRITICAL - MUST FOLLOW EXACTLY):
   ⚠️ HARD CONSTRAINT: All dialogue must be concise and speakable within 6-8 seconds maximum.
   
   Style Guidelines:
   - Use short, simple sentences (prefer one sentence, maximum two if very brief)
   - Warm, clear, conversational, and energetic tone
   - NOT instructional or overly explanatory
   - Avoid compound explanations or multiple concepts in one line
   - Optimize for early-child comprehension
   
   Examples from Try Experiences episodes:
   ✅ "Oh no… this little plant is tired. Have you ever wondered how plants make their food?"
   ✅ "Plants need sunlight! Can you draw a bright sun in the sky to help our plant?"
   ✅ "Let's help this room save energy!"
   ❌ "Today we are going to learn several important ways to conserve electrical power…"
   ❌ "Now I want you to think carefully about all the different types of…"

5. INTERACTION DESIGN FRAMEWORK (CRITICAL - DEMONSTRATE-EXPLAIN-TRANSFER):
   
   ⚠️ PEDAGOGICAL STRUCTURE - Follow this 3-step learning pattern:
   
   Step 1: DEMONSTRATE
   - Show one clear example visually in the video
   - Make the concept concrete and observable
   
   Step 2: EXPLAIN
   - Briefly explain the idea using short, child-friendly dialogue
   - Connect the demonstration to the underlying concept
   
   Step 3: TRANSFER TASK (The Interaction Checkpoint)
   - Present a NEW situation where the learner must APPLY the idea
   - This is where the interaction happens
   - The child must transfer their understanding to a novel context
   
   ⚠️ INTERACTION DESIGN RULES:
   
   Interaction checkpoints must require the learner to:
   • Infer (figure out from clues)
   • Decide (choose between options)
   • Identify (recognize patterns or problems)
   • Predict (anticipate outcomes)
   • Classify (sort or categorize)
   • Fix a problem (correct errors)
   • Design a solution (create something new)
   
   ⚠️ CRITICAL RULE — DO NOT REVEAL ANSWERS:
   Dialogue MUST NOT directly contain the answer immediately before the interaction checkpoint.
   
   Instead:
   - Provide clues
   - Describe properties
   - Encourage reasoning
   - The child should experience a moment of recognition
   
   Examples:
   ❌ BAD: "Draw a light bulb."
   ✅ GOOD: "It brightens a room when it gets dark — what should we turn off when we leave?"
   
   ❌ BAD: "Plants need sunlight! Draw a sun."
   ✅ GOOD: "This plant looks sad. What does it need from the sky to grow?"
   
   ⚠️ LETTER LEARNING INTERACTIONS (for alphabet/letter topics):
   When the topic involves learning letters or words:
   
   Interaction Types:
   1. OBJECT NAMING: Show an object and ask the child to name it or identify what letter it starts with
      Example: "I see something round and red! What is it called? It starts with the letter A!"
      Task: "Say the name of this object" or "What letter does this start with?"
   
   2. DRAWING WITH HINTS: Ask the child to draw an object that starts with a specific letter, with visual hints
      Example: "Can you draw something that starts with the letter B? It bounces and is round!"
      Task: "Draw a [object] that starts with letter [X]"
      Expected: "A drawing of a ball (or similar B-word object)"
   
   3. LETTER RECOGNITION: Show objects and ask which one starts with a specific letter
      Example: "I have an apple and a banana. Which one starts with the letter A?"
      Task: "Point to or say which object starts with letter [X]"
   
   4. WORD BUILDING: Show the first letter and ask what word it could be
      Example: "This word starts with C and you can ride in it! What is it?"
      Task: "Say or draw the word that starts with [letter] and matches the clue"
   
   Always provide:
   - Clear visual or verbal hints
   - Age-appropriate vocabulary
   - Encouraging, playful tone
   - Objects/words familiar to young children
   
   ⚠️ TASK VARIETY REQUIREMENT:
   Each episode MUST include a mix of interaction types:
   • Detection tasks (find what is wrong)
   • Decision tasks (choose the smarter option)
   • Prediction tasks (guess what will happen)
   
   ⚠️ MULTI-MODAL INTERACTIONS:
   Interactions do NOT have to be drawing only. Consider:
   - Voice responses (answering questions)
   - Selection tasks (pointing/clicking)
   - Drawing tasks (creating or fixing)
   - Combination tasks (both voice and drawing)
   
   Implementation Rules:
   - Tasks must be age-appropriate and clearly defined
   - expected_response should be specific enough for evaluation
   - interaction_mode: choose "draw", "voice", or "both" based on task type
   - Dialogue should be engaging, encouraging, and educational (following dialogue requirements above)
   - Dialogue must provide clues but NEVER directly state the answer

6. VIDEO-NATIVE INTERACTION CHECKPOINT REQUIREMENTS:
   For DRAWING-based checkpoints (interaction_mode: "draw" or "both"):
   - The video prompt MUST explicitly reserve a blank area for drawing input
   - Examples: "empty drawing board area", "blank thought bubble", "blank white card on table", "empty space overlay on the right side"
   - The blank area must be clearly visible and unobstructed
   - Use phrases like "LARGE BLANK WHITE BOARD", "completely empty with generous drawing space"
   - Ensure high contrast and clear boundaries for the drawing area
   
   For VOICE-based checkpoints (interaction_mode: "voice" or "both"):
   - Prompts should clearly ask an answerable question suitable for speech
   - Questions should have specific, evaluable answers
   - Avoid open-ended questions that can't be automatically evaluated
   - Use clear, direct language appropriate for children

7. VEO PROMPT GUIDELINES:
   - Each prompt should be detailed and specific for video generation
   - Maintain visual consistency across scenes
   - Include character actions, environment, and key visual elements
   - Keep prompts focused and clear
   - For interactive scenes, ALWAYS specify the blank drawing area explicitly
   - Use "NO readable text" to avoid unwanted text in videos
   
   ⚠️ CHARACTER CONSISTENCY IN PROMPTS:
   - ONLY the user's character should appear in every scene
   - NO other characters, companions, friends, or background characters
   - NO new characters introduced in Scene 2, 3, 4, or any later scenes
   - The character is ALWAYS ALONE, interacting directly with the viewer
   - Reference the character by NAME only in prompts (e.g., "Lumi", not "Lumi the bunny")
   - Maintain the EXACT SAME character design, appearance, and personality throughout
   - If you need multiple entities, use INANIMATE OBJECTS (plants, objects, items) NOT other characters
   
   ⚠️ CRITICAL VEO CONTENT POLICY - SAFETY REQUIREMENTS (MUST FOLLOW):
   
   FORBIDDEN WORDS - NEVER use these terms (violate Google's Responsible AI practices):
   - "child", "children", "kid", "kids", "toddler", "baby", "infant"
   - "human", "person", "people", "man", "woman", "boy", "girl"
   - Any age-specific human descriptors
   
   FORBIDDEN THEMES & CONTENT - NEVER include:
   - Violence, weapons, fighting, danger, harm, injury
   - Scary, dark, horror, frightening, threatening content
   - Negative emotions: fear, sadness, anger, distress
   - Inappropriate objects: guns, knives, alcohol, drugs, cigarettes
   - Mature themes: romance, dating, adult situations
   - Religious or political content
   - Death, dying, illness, medical procedures
   - Bullying, meanness, exclusion, conflict
   - Disasters, accidents, emergencies
   - Anything that could frighten or upset young viewers
   
   REQUIRED SAFE ALTERNATIVES:
   ✅ Characters: Animal characters (bunny, fox, bear), fantasy creatures (dragon, unicorn), robots
   ✅ Use "young character", "learner", "student", "viewer", "friend" instead of human terms
   ✅ Themes: Positive, educational, encouraging, joyful, curious, friendly
   ✅ Tone: Warm, bright, cheerful, supportive, gentle, playful
   ✅ Settings: Colorful, safe, inviting, magical, nature-based, learning environments
   ✅ Actions: Exploring, discovering, learning, helping, creating, solving puzzles
   
   All characters MUST be non-human animated characters.
   All content must be age-appropriate, positive, and educational.

8. EPISODE TOPIC INTEGRATION:
   - The episode_topic "{episode_topic}" should be the central theme
   - Build a complete learning arc across all 8 scenes
   - Make learning engaging and age-appropriate
   - Each scene should build on previous scenes

Generate the complete 8-scene episode JSON now. Think carefully about the educational flow and interaction design. Use the reference episode as a style and quality guide.
"""

    response = client.models.generate_content(
        model=GEMINI_3_MODEL,
        contents=planning_prompt,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.HIGH,
                include_thoughts=False,
            ),
            response_mime_type="application/json",
        ),
    )
    
    episode_json = json.loads(response.text)
    return episode_json


# ------------------------------------------------------------------------------
# Phase B: Scene Expansion (Mixed thinking levels)
# ------------------------------------------------------------------------------

def expand_scene(
    client: genai.Client,
    scene_stub: Dict[str, Any],
    episode_context: Dict[str, Any],
    thinking_level: str
) -> Dict[str, Any]:
    """
    Expand a scene stub into a complete scene with proper fields.
    Uses specified thinking level (HIGH for interactive, LOW for non-interactive).
    """
    
    scene_num = scene_stub.get("scene_number")
    is_interactive = scene_stub.get("interaction", False)
    
    expansion_prompt = f"""
You are refining scene {scene_num} of an educational episode.

EPISODE CONTEXT:
- Title: {episode_context.get('title')}
- Description: {episode_context.get('description')}
- Skills: {', '.join(episode_context.get('skills', []))}

SCENE STUB:
{json.dumps(scene_stub, indent=2)}

CHARACTER CONSISTENCY (CRITICAL - MUST FOLLOW):
⚠️ ONLY ONE CHARACTER: The character from the reference image is the ONLY character in this scene
- NO other characters should appear or be mentioned
- This character is alone, interacting directly with the viewer
- Reference the character by NAME only (not species/type)
- All dialogue is spoken by ONLY this character

TASK:
{"INTERACTIVE SCENE - " if is_interactive else "NON-INTERACTIVE SCENE - "}
Enhance this scene with:
1. A detailed, specific Veo video generation prompt (200-300 words)
2. Engaging, age-appropriate dialogue (CRITICAL: must be speakable within 6-8 seconds maximum)
{"3. A clear, testable task description" if is_interactive else ""}
{"4. Specific expected_response criteria for evaluation" if is_interactive else ""}

DIALOGUE REQUIREMENTS (MUST FOLLOW):
⚠️ HARD CONSTRAINT: All dialogue must be concise and speakable within 6-8 seconds maximum.
- Use short, simple sentences (prefer one sentence, maximum two if very brief)
- Warm, clear, conversational, and energetic tone
- NOT instructional or overly explanatory
- Avoid compound explanations or multiple concepts in one line
- Optimize for early-child comprehension

Examples:
✅ "Oh no… this little plant is tired. Have you ever wondered how plants make their food?"
✅ "Plants need sunlight! Can you draw a bright sun in the sky to help our plant?"
✅ "Let's help this room save energy!"
❌ "Today we are going to learn several important ways to conserve electrical power…"

{"INTERACTION DESIGN FRAMEWORK (CRITICAL FOR INTERACTIVE SCENES):" if is_interactive else ""}
{"" if is_interactive else ""}
{"⚠️ DEMONSTRATE-EXPLAIN-TRANSFER STRUCTURE:" if is_interactive else ""}
{"- This scene should follow the transfer task pattern (applying learned concept to NEW situation)" if is_interactive else ""}
{"- Dialogue provides clues and encourages reasoning, NOT direct answers" if is_interactive else ""}
{"" if is_interactive else ""}
{"⚠️ INTERACTION DESIGN RULES:" if is_interactive else ""}
{"Tasks must require: infer, decide, identify, predict, classify, fix a problem, or design a solution" if is_interactive else ""}
{"" if is_interactive else ""}
{"⚠️ CRITICAL - DO NOT REVEAL ANSWERS:" if is_interactive else ""}
{"Dialogue MUST NOT contain the answer before the checkpoint. Provide clues, describe properties, encourage reasoning." if is_interactive else ""}
{"" if is_interactive else ""}
{"Examples:" if is_interactive else ""}
{"❌ BAD: 'Draw a light bulb.'" if is_interactive else ""}
{"✅ GOOD: 'It brightens a room when it gets dark — what should we turn off when we leave?'" if is_interactive else ""}
{"" if is_interactive else ""}
{"⚠️ TASK VARIETY:" if is_interactive else ""}
{"Use detection (find what's wrong), decision (choose best option), or prediction (guess outcome) tasks" if is_interactive else ""}
{"" if is_interactive else ""}
{"⚠️ MULTI-MODAL:" if is_interactive else ""}
{"Consider voice, drawing, selection, or combination tasks - not just drawing" if is_interactive else ""}
{"" if is_interactive else ""}
{"- Ensure the task is clear and the expected_response is specific enough for automated evaluation" if is_interactive else ""}

⚠️ CRITICAL VEO CONTENT POLICY - SAFETY REQUIREMENTS (MUST FOLLOW):

FORBIDDEN WORDS - NEVER use these terms (violate Google's Responsible AI practices):
- "child", "children", "kid", "kids", "toddler", "baby", "infant"
- "human", "person", "people", "man", "woman", "boy", "girl"
- Any age-specific human descriptors

FORBIDDEN THEMES & CONTENT - NEVER include:
- Violence, weapons, fighting, danger, harm, injury
- Scary, dark, horror, frightening, threatening content
- Negative emotions: fear, sadness, anger, distress
- Inappropriate objects: guns, knives, alcohol, drugs, cigarettes
- Mature themes: romance, dating, adult situations
- Religious or political content
- Death, dying, illness, medical procedures
- Bullying, meanness, exclusion, conflict
- Disasters, accidents, emergencies
- Anything that could frighten or upset young viewers

REQUIRED SAFE ALTERNATIVES:
✅ Characters: Animal characters (bunny, fox, bear), fantasy creatures (dragon, unicorn), robots
✅ Use "young character", "learner", "student", "viewer", "friend" instead of human terms
✅ Themes: Positive, educational, encouraging, joyful, curious, friendly
✅ Tone: Warm, bright, cheerful, supportive, gentle, playful
✅ Settings: Colorful, safe, inviting, magical, nature-based, learning environments
✅ Actions: Exploring, discovering, learning, helping, creating, solving puzzles

All characters MUST be non-human animated characters.
All content must be age-appropriate, positive, and educational.

Return the complete scene JSON with all required fields.
"""

    response = client.models.generate_content(
        model=GEMINI_3_MODEL,
        contents=expansion_prompt,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                thinking_level=thinking_level,
                include_thoughts=False
            ),
            response_mime_type="application/json"
        )
    )
    
    expanded_scene = json.loads(response.text)
    
    # FIX: Unwrap if Gemini returned a list instead of a dict
    if isinstance(expanded_scene, list) and len(expanded_scene) > 0:
        expanded_scene = expanded_scene[0]
    elif not isinstance(expanded_scene, dict):
        print(f"[WARNING] Scene {scene_num} expansion returned unexpected type, using original")
        return scene_stub
    
    return expanded_scene


def expand_all_scenes(
    client: genai.Client,
    episode_plan: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Phase B: Expand all scenes with appropriate thinking levels.
    HIGH thinking for scenes 2, 4, 6 (interactive)
    LOW thinking for scenes 1, 3, 5, 7, 8 (non-interactive)
    """
    
    expanded_scenes = []
    
    for scene in episode_plan["scenes"]:
        scene_num = scene.get("scene_number")
        
        # Determine thinking level based on scene type
        if scene_num in INTERACTIVE_SCENE_INDICES:
            thinking_level = types.ThinkingLevel.HIGH
        else:
            thinking_level = types.ThinkingLevel.LOW
        
        # Expand the scene
        expanded_scene = expand_scene(
            client=client,
            scene_stub=scene,
            episode_context={
                "title": episode_plan.get("title"),
                "description": episode_plan.get("description"),
                "skills": episode_plan.get("skills", [])
            },
            thinking_level=thinking_level
        )
        
        expanded_scenes.append(expanded_scene)
    
    # Update episode with expanded scenes
    episode_plan["scenes"] = expanded_scenes
    return episode_plan


# ------------------------------------------------------------------------------
# Repair and Retry Logic
# ------------------------------------------------------------------------------

def repair_episode_with_gemini(
    client: genai.Client,
    episode_data: Dict[str, Any],
    validation_errors: List[str]
) -> Dict[str, Any]:
    """
    Use Gemini to repair a failed episode based on validation errors.
    """
    
    repair_prompt = f"""
The following episode JSON has validation errors. Fix them and return a corrected version.

VALIDATION ERRORS:
{chr(10).join(f"- {error}" for error in validation_errors)}

CURRENT EPISODE JSON:
{json.dumps(episode_data, indent=2)}

REQUIREMENTS:
- Exactly 8 scenes
- Only scenes 2, 4, 6 should have "interaction": true
- Interactive scenes MUST have: interaction_mode, task, expected_response, correct_feedback_url, incorrect_feedback_url, idle_url
- Non-interactive scenes MUST NOT have those fields
- All scenes must have: scene_number, interaction, video_url, prompt, dialogue

Return the corrected episode JSON.
"""

    response = client.models.generate_content(
        model=GEMINI_3_MODEL,
        contents=repair_prompt,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.HIGH,
                include_thoughts=False,
            ),
            response_mime_type="application/json",
        ),
    )
    
    repaired_episode = json.loads(response.text)
    return repaired_episode


def generate_episode(
    episode_topic: str,
    story_style: str,
    character_image_base64: Optional[str] = None,
    character_description: Optional[str] = None
) -> Dict[str, Any]:
    """
    Main pipeline: Generate a complete episode using Gemini 3 Pro with thinking levels.
    
    Args:
        episode_topic: The educational topic/theme for the episode
        story_style: Selected story style (e.g., "high-quality", "claymation")
        character_image_base64: Optional base64-encoded character image
        character_description: Optional text description of character
    
    Returns:
        Complete validated episode JSON
    
    Raises:
        ValueError: If episode generation fails after max retries
    """
    
    client = get_gemini_client()
    
    # Phase A: Generate episode plan with HIGH thinking
    print("[Phase A] Generating episode plan with HIGH thinking...")
    episode_plan = generate_episode_plan(
        client=client,
        episode_topic=episode_topic,
        story_style=story_style,
        character_description=character_description
    )
    
    # Phase B: Expand scenes with mixed thinking levels
    print("[Phase B] Expanding scenes with mixed thinking levels...")
    complete_episode = expand_all_scenes(client, episode_plan)
    
    # Validation and retry loop
    for attempt in range(MAX_VALIDATION_RETRIES):
        print(f"[Validation] Attempt {attempt + 1}/{MAX_VALIDATION_RETRIES}")
        
        is_valid, errors = validate_episode_schema(complete_episode)
        
        if is_valid:
            print("[Success] Episode validated successfully!")
            return complete_episode
        
        print(f"[Validation Failed] Errors: {errors}")
        
        if attempt < MAX_VALIDATION_RETRIES - 1:
            print("[Repair] Attempting to repair episode...")
            complete_episode = repair_episode_with_gemini(
                client=client,
                episode_data=complete_episode,
                validation_errors=errors
            )
        else:
            raise ValueError(
                f"Episode generation failed after {MAX_VALIDATION_RETRIES} attempts. "
                f"Final errors: {errors}"
            )
    
    raise ValueError("Episode generation failed - should not reach here")


def convert_episode_to_veo_request(
    episode_data: Dict[str, Any],
    character_image_base64: Optional[str] = None
) -> Dict[str, Any]:
    """
    Convert Gemini-generated episode JSON to Veo generation request format.
    
    Args:
        episode_data: Complete episode JSON from Gemini
        character_image_base64: Optional character reference image
    
    Returns:
        Request payload for Veo generation endpoint
    """
    
    veo_scenes = []
    
    for scene in episode_data["scenes"]:
        veo_scene = {
            "prompt": scene["prompt"],
            "dialogue": scene.get("dialogue"),
            "interaction": scene.get("interaction", False)
        }
        
        # Add interaction-specific fields for interactive scenes
        if scene.get("interaction"):
            veo_scene["task"] = scene.get("task")
            veo_scene["expected_response"] = scene.get("expected_response")
            veo_scene["interaction_mode"] = scene.get("interaction_mode", "both")
        
        veo_scenes.append(veo_scene)
    
    veo_request = {
        "scenes": veo_scenes,
        "duration_seconds": 8,
        "aspect_ratio": "16:9",
        "generate_audio": True
    }
    
    # Add character reference image if provided
    if character_image_base64:
        veo_request["style_reference_image_base64"] = character_image_base64
    
    return veo_request


def generate_videos_for_episode(
    episode_data: Dict[str, Any],
    character_image_base64: Optional[str] = None
) -> Dict[str, Any]:
    """
    Trigger Veo video generation for the episode and return complete episode with video URLs.
    
    Args:
        episode_data: Validated episode JSON from Gemini
        character_image_base64: Optional character reference image
    
    Returns:
        Complete episode with actual video URLs from Veo
    """
    
    print("[Veo Generation] Converting episode to Veo request format...")
    veo_request = convert_episode_to_veo_request(episode_data, character_image_base64)
    
    print(f"[Veo Generation] Sending request to Veo endpoint: {VEO_GENERATION_ENDPOINT}")
    print(f"[Veo Generation] Generating {len(veo_request['scenes'])} scenes...")
    print(f"[Veo Generation] Calling Veo service at: {VEO_GENERATION_ENDPOINT}")
    
    # Call the Veo generation endpoint
    # Note: This runs in a background task, so the long timeout is fine
    response = requests.post(
        VEO_GENERATION_ENDPOINT,
        json=veo_request,
        timeout=7200  # 2 hour timeout for video generation
    )
    
    if response.status_code != 200:
        raise ValueError(
            f"Veo generation failed with status {response.status_code}: {response.text}"
        )
    
    veo_response = response.json()
    
    print("[Veo Generation] Successfully generated all videos!")
    print(f"[Veo Generation] Stitched video URL: {veo_response.get('stitched_video_url')[:100]}...")
    
    # Update episode with actual video URLs from Veo
    for i, scene in enumerate(episode_data["scenes"]):
        # Update main scene video URL
        scene["video_url"] = veo_response["scene_video_urls"][i]
        
        # Update feedback and idle URLs for interactive scenes
        if scene.get("interaction"):
            feedback_urls = veo_response["scene_feedback_urls"][i]
            if feedback_urls:
                scene["correct_feedback_url"] = feedback_urls["correct_url"]
                scene["incorrect_feedback_url"] = feedback_urls["incorrect_url"]
            
            idle_url = veo_response["scene_idle_urls"][i]
            if idle_url:
                scene["idle_url"] = idle_url
    
    # Add stitched video URL to episode metadata
    episode_data["stitched_video_url"] = veo_response["stitched_video_url"]
    
    return episode_data


def generate_complete_episode(
    episode_topic: str,
    story_style: str,
    character_image_base64: Optional[str] = None,
    character_description: Optional[str] = None
) -> Dict[str, Any]:
    """
    Complete pipeline: Generate episode JSON with Gemini, then generate videos with Veo.
    
    This is the main entry point for Create Your Own Episode.
    
    Args:
        episode_topic: The educational topic/theme for the episode
        story_style: Selected story style
        character_image_base64: Optional base64-encoded character image
        character_description: Optional text description of character
    
    Returns:
        Complete episode with actual video URLs, ready to play
    """
    
    # Step 1: Generate episode JSON with Gemini 3 Pro
    print("[Pipeline] Step 1: Generating episode JSON with Gemini 3 Pro...")
    episode_data = generate_episode(
        episode_topic=episode_topic,
        story_style=story_style,
        character_image_base64=character_image_base64,
        character_description=character_description
    )
    
    print(f"[Pipeline] Episode JSON generated: {episode_data['episode_id']}")
    
    # Step 2: Generate videos with Veo
    print("[Pipeline] Step 2: Generating videos with Veo...")
    complete_episode = generate_videos_for_episode(
        episode_data=episode_data,
        character_image_base64=character_image_base64
    )
    
    print(f"[Pipeline] Complete! Episode ready: {complete_episode['episode_id']}")
    
    return complete_episode
