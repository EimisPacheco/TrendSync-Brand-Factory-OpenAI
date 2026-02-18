"""
Tech Pack Generator
Uses Gemini 3 Pro to generate detailed technical specifications for fashion products.
"""

import json
import os
from typing import Any, Dict
from google import genai
from google.genai import types


GEMINI_PRO_MODEL = os.environ.get("GEMINI_PRO_MODEL", "gemini-3-pro-preview")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")


def get_client() -> genai.Client:
    return genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)


DEFAULT_TECHPACK = {
    "fabric_details": {
        "primary_fabric": "To be determined",
        "composition": "N/A",
        "weight": "N/A",
        "care_instructions": "See care label",
    },
    "measurements": {
        "sizes": ["XS", "S", "M", "L", "XL"],
        "key_measurements": {},
    },
    "graphics_and_prints": {"type": "None", "details": "N/A"},
    "adornments": {"type": "None", "details": "N/A"},
    "construction": {
        "seam_type": "Standard",
        "stitch_count": "N/A",
        "special_instructions": "None",
    },
    "quality_control": {
        "inspection_points": ["Seam integrity", "Color consistency", "Size accuracy"],
        "tolerance": "Standard industry tolerance",
    },
    "packaging": {
        "folding_method": "Standard fold",
        "labels": ["Brand label", "Care label", "Size label"],
        "hangtags": "Brand hangtag",
    },
}


def generate_techpack(product: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate a full tech pack for a fashion product using Gemini 3 Pro.
    Uses LOW thinking level — straightforward structured output.
    """
    client = get_client()

    prompt = f"""You are a fashion technical designer. Generate a detailed tech pack for this product:

PRODUCT:
- Name: {product.get('name', 'Unknown')}
- Category: {product.get('category', 'Unknown')}
- Description: {product.get('description', '')}
- Material: {product.get('material', '')}
- Color Story: {product.get('color_story', '')}
- Target Price: {product.get('target_price', '')}

Generate a comprehensive tech pack JSON with these sections:

{{
  "fabric_details": {{
    "primary_fabric": "Fabric name and type",
    "composition": "e.g., 95% Cotton, 5% Elastane",
    "weight": "e.g., 180 GSM",
    "care_instructions": "Detailed care instructions"
  }},
  "measurements": {{
    "sizes": ["XS", "S", "M", "L", "XL"],
    "key_measurements": {{
      "chest": {{"XS": "86cm", "S": "90cm", "M": "94cm", "L": "98cm", "XL": "102cm"}},
      "length": {{"XS": "64cm", "S": "66cm", "M": "68cm", "L": "70cm", "XL": "72cm"}}
    }}
  }},
  "graphics_and_prints": {{
    "type": "Print type or None",
    "details": "Placement, technique, colours"
  }},
  "adornments": {{
    "type": "Buttons/Zippers/Embroidery/None",
    "details": "Specifications"
  }},
  "construction": {{
    "seam_type": "e.g., Flatlock, Overlock",
    "stitch_count": "e.g., 10 stitches per inch",
    "special_instructions": "Any special construction notes"
  }},
  "quality_control": {{
    "inspection_points": ["Point 1", "Point 2", "Point 3"],
    "tolerance": "Acceptable tolerance details"
  }},
  "packaging": {{
    "folding_method": "Folding specification",
    "labels": ["Label types"],
    "hangtags": "Hangtag specification"
  }}
}}

Be realistic and detailed. Base measurements on the category and target demographic."""

    try:
        response = client.models.generate_content(
            model=GEMINI_PRO_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.LOW,
                    include_thoughts=False,
                ),
                response_mime_type="application/json",
            ),
        )

        techpack = json.loads(response.text)
        if isinstance(techpack, list) and len(techpack) > 0:
            techpack = techpack[0]
        return techpack

    except Exception as e:
        print(f"[TechPack] Generation failed: {e}, using defaults")
        return DEFAULT_TECHPACK
