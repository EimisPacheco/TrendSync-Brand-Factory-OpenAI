"""
Character Generator
Uses Gemini Flash to analyze drawings and Vertex AI Imagen 3 to generate high-quality animated characters.
"""

import os
import base64
import tempfile
import time
from typing import Optional
from google import genai
from google.genai import types


# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------

GEMINI_FLASH_MODEL = "gemini-2.5-flash"
GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "toonlabs")
# Use 'global' location for consistency with Gemini 3 Pro
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")


# ------------------------------------------------------------------------------
# Character Generation Prompt
# ------------------------------------------------------------------------------

CHARACTER_GENERATION_PROMPT = """
You are an expert character designer for children's educational content.

TASK:
Transform the provided child's drawing into a professional, high-quality 3D animated character suitable for educational videos.

CRITICAL REQUIREMENTS:

1. PRESERVE THE CHILD'S VISION:
   - Keep the core essence and personality of the child's drawing
   - Maintain the character's key features (colors, shapes, distinctive elements)
   - Honor the child's creative choices while enhancing quality

2. ANIMATION-READY CHARACTER DESIGN:
   - Clean, professional 3D cartoon style
   - Vibrant, appealing color palette
   - Expressive face with clear features
   - Friendly, approachable appearance
   - Suitable for children aged 4-8

3. TECHNICAL SPECIFICATIONS:
   - High resolution, sharp details
   - Consistent lighting (soft, bright, even)
   - Neutral background (white or very light gray)
   - Character centered in frame
   - Full body visible (head to feet)
   - Standing pose, facing forward
   - Clear silhouette

4. STYLE GUIDELINES:
   - Modern 3D animated cartoon aesthetic (think Pixar/Disney quality)
   - Smooth surfaces, no rough textures
   - Bright, saturated colors
   - Gentle shading and highlights
   - Professional rendering quality
   - Child-friendly and educational tone

5. AVOID:
   - Scary or dark elements
   - Overly realistic features
   - Complex backgrounds
   - Multiple characters
   - Text or logos
   - Harsh shadows or dramatic lighting

Generate a single, high-quality character image that will serve as the reference for all scenes in an educational video series.
"""


# ------------------------------------------------------------------------------
# Gemini Client Setup
# ------------------------------------------------------------------------------

def get_gemini_client() -> genai.Client:
    """Initialize and return Gemini client with Vertex AI credentials."""
    # Use Vertex AI authentication instead of API key
    return genai.Client(
        vertexai=True,
        project=PROJECT_ID,
        location=LOCATION
    )


# ------------------------------------------------------------------------------
# Character Generation
# ------------------------------------------------------------------------------

def generate_character_from_drawing(
    drawing_base64: str,
    character_name: Optional[str] = None,
    character_description: Optional[str] = None
) -> str:
    """
    Generate a high-quality animated character from a child's drawing.
    
    Two-step process:
    1. Use Gemini Flash to analyze the drawing and create a detailed image generation prompt
    2. Use Imagen 3 to generate the professional character image
    
    Args:
        drawing_base64: Base64-encoded image of child's drawing
        character_name: Optional name for the character
        character_description: Optional additional description
    
    Returns:
        Base64-encoded image of the generated professional character
    """
    
    client = get_gemini_client()
    
    # Decode the drawing image
    drawing_bytes = base64.b64decode(drawing_base64)
    
    # Save to temporary file for Gemini
    fd, temp_drawing_path = tempfile.mkstemp(suffix=".png")
    with os.fdopen(fd, "wb") as tmp:
        tmp.write(drawing_bytes)
    
    # Load the drawing image
    drawing_image = types.Part.from_bytes(
        data=drawing_bytes,
        mime_type="image/png"
    )
    
    print(f"[Character Generation] Step 1: Analyzing drawing{f' for {character_name}' if character_name else ''}...")
    
    # Step 1: Use Gemini to analyze the drawing and create a detailed prompt
    analysis_prompt = f"""
Analyze this child's drawing and create a detailed image generation prompt that will transform it into a MUCH MORE DETAILED, HIGH-QUALITY animated character.

TASK: Create a prompt that will generate a professional, polished 3D animated character INSPIRED BY this drawing.

CHARACTER NAME: {character_name if character_name else "the character"}
{f"ADDITIONAL CONTEXT: {character_description}" if character_description else ""}

CRITICAL APPROACH:
- The child's drawing is INSPIRATION, not the final product
- Take their creative vision and elevate it to professional animation quality
- Add rich details, textures, and refinement while preserving their core idea
- Transform simple shapes into fully-realized, expressive animated characters

REQUIREMENTS FOR YOUR PROMPT:
1. Identify the CHARACTER TYPE from the drawing (animal, person, creature, etc.) and their key features
2. Create a HIGHLY DETAILED, POLISHED version with:
   - Professional 3D animated character in Pixar/Disney/Illumination style
   - Rich surface details, textures, and materials (fur, fabric, skin, etc.)
   - Expressive facial features with personality and charm
   - Refined proportions and appealing character design
   - Vibrant, harmonious color palette inspired by the drawing
3. Specify technical quality: "high resolution, professional rendering, soft studio lighting, clean details"
4. Specify composition: "full body, centered, standing pose, facing forward, neutral white background"
5. Emphasize: "child-friendly, educational, warm and inviting, animation-ready"
6. PRESERVE the child's creative vision (their color choices, character type, personality)
7. ENHANCE with professional polish, detail, and appeal

EXAMPLE TRANSFORMATION:
- Child draws simple orange cat → Generate: "Professional 3D animated orange tabby cat character with soft, detailed fur texture, bright expressive green eyes, friendly smile, wearing a small blue scarf, Pixar-style rendering..."

OUTPUT: Just the detailed image generation prompt (250-350 words). Make it rich, specific, and professional.
"""

    # Generate prompt with retry logic for rate limits
    max_retries = 3
    retry_delay = 2
    
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=GEMINI_FLASH_MODEL,
                contents=[drawing_image, analysis_prompt],
                config=types.GenerateContentConfig(
                    temperature=0.7,
                    top_p=0.9,
                )
            )
            break  # Success
        except Exception as api_error:
            error_str = str(api_error)
            if "429" in error_str or "Resource exhausted" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                if attempt < max_retries - 1:
                    wait_time = retry_delay * (2 ** attempt)
                    print(f"[Character Generation] Gemini rate limit hit, waiting {wait_time}s before retry {attempt + 1}/{max_retries}...")
                    time.sleep(wait_time)
                    continue
                else:
                    raise Exception("That didn't work, we could be facing high demand. Please try a different drawing. Keep it kid-appropriate and avoid characters or logos that resemble copyrighted IP.")
            # Check for content policy violations or inappropriate content
            elif "BLOCKED" in error_str.upper() or "SAFETY" in error_str.upper() or "INAPPROPRIATE" in error_str.upper() or "POLICY" in error_str.upper():
                raise Exception("Sorry, we can't generate that character. Please try drawing something else that's kid-friendly and doesn't resemble copyrighted characters.")
            else:
                raise
    
    imagen_prompt = response.text.strip()
    print(f"[Character Generation] Generated Imagen prompt: {imagen_prompt[:100]}...")
    
    # Clean up temp file
    if os.path.exists(temp_drawing_path):
        os.remove(temp_drawing_path)
    
    # Step 2: Use Gemini 2.5 Flash to generate the character image
    print("[Character Generation] Step 2: Generating professional character with Gemini 2.5 Flash...")
    
    try:
        # Generate image with retry logic for rate limits
        max_retries = 3
        retry_delay = 2
        
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=GEMINI_IMAGE_MODEL,
                    contents=imagen_prompt,
                    config=types.GenerateContentConfig(
                        response_modalities=["image"],
                        temperature=0.7,
                    )
                )
                break  # Success
            except Exception as api_error:
                error_str = str(api_error)
                if "429" in error_str or "Resource exhausted" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                    if attempt < max_retries - 1:
                        wait_time = retry_delay * (2 ** attempt)
                        print(f"[Character Generation] Rate limit hit, waiting {wait_time}s before retry {attempt + 1}/{max_retries}...")
                        time.sleep(wait_time)
                        continue
                    else:
                        raise Exception("That didn't work, we could be facing high demand. Please try a different drawing. Keep it kid-appropriate and avoid characters or logos that resemble copyrighted IP.")
                # Check for content policy violations or inappropriate content
                elif "BLOCKED" in error_str.upper() or "SAFETY" in error_str.upper() or "INAPPROPRIATE" in error_str.upper() or "POLICY" in error_str.upper():
                    raise Exception("That didn't work, we could be facing high demand. Please try a different drawing. Keep it kid-appropriate and avoid characters or logos that resemble copyrighted IP.")
                else:
                    raise
        
        # Extract the generated image from response
        generated_image = None
        for part in response.parts:
            if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                generated_image = part.inline_data.data
                break
        
        if not generated_image:
            raise Exception("That didn't work, we could be facing high demand. Please try a different drawing. Keep it kid-appropriate and avoid characters or logos that resemble copyrighted IP.")
        
        print("[Character Generation] Successfully generated professional character!")
        
        # Return as base64
        return base64.b64encode(generated_image).decode('utf-8')
        
    except Exception as e:
        error_msg = str(e)
        print(f"[Character Generation] Error: {error_msg}")
        
        # If it's already our user-friendly message, pass it through
        if "Oops, try drawing a different type of character!" in error_msg:
            raise
        
        # Convert to user-friendly message
        raise Exception("Oops, try drawing a different type of character!")


# ------------------------------------------------------------------------------
# Alternative: Text-to-Image Character Generation
# ------------------------------------------------------------------------------

def generate_character_from_description(
    character_name: str,
    character_description: str
) -> str:
    """
    Generate a character from text description only (no drawing).
    Useful if user doesn't want to draw.
    
    Args:
        character_name: Name of the character
        character_description: Description of what the character should look like
    
    Returns:
        Base64-encoded image of the generated character
    """
    
    client = get_gemini_client()
    
    prompt = f"""
{CHARACTER_GENERATION_PROMPT}

CHARACTER NAME: {character_name}
CHARACTER DESCRIPTION: {character_description}

Generate a high-quality 3D animated character that matches this description perfectly.
The character should be professional, child-friendly, and ready to use in educational videos.
"""
    
    print(f"[Character Generation] Generating character '{character_name}' from description...")
    
    response = client.models.generate_content(
        model=GEMINI_FLASH_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.7,
            top_p=0.9,
            top_k=40,
        )
    )
    
    # Extract the generated image
    generated_image = None
    for part in response.parts:
        if part.inline_data and part.inline_data.mime_type.startswith("image/"):
            generated_image = part.inline_data.data
            break
    
    if not generated_image:
        raise ValueError("Gemini did not return a generated character image")
    
    print("[Character Generation] Successfully generated character from description!")
    
    return base64.b64encode(generated_image).decode('utf-8')
