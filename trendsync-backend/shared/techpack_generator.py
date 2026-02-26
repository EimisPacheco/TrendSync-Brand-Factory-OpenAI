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


def _build_default_techpack(product: Dict[str, Any]) -> Dict[str, Any]:
    """Build a techpack from product data when Gemini is unavailable."""
    # Extract materials
    materials_list = product.get("materials", [])
    material_str = product.get("material", "")
    if materials_list and not material_str:
        material_str = ", ".join(
            m.get("name", str(m)) if isinstance(m, dict) else str(m)
            for m in materials_list
        )

    # Infer fabric from material or category
    category = product.get("category", "apparel")
    subcategory = product.get("subcategory", "")
    fabric_map = {
        "dress": ("Lightweight Woven Fabric", "100% Polyester", "120 GSM"),
        "jacket": ("Mid-Weight Twill", "65% Cotton, 35% Polyester", "220 GSM"),
        "shirt": ("Cotton Poplin", "100% Cotton", "130 GSM"),
        "pants": ("Stretch Denim", "98% Cotton, 2% Elastane", "280 GSM"),
        "skirt": ("Crepe Fabric", "100% Polyester", "150 GSM"),
        "coat": ("Heavy Wool Blend", "70% Wool, 30% Polyester", "350 GSM"),
        "sweater": ("Knit Fabric", "80% Cotton, 20% Nylon", "200 GSM"),
        "footwear": ("Premium Leather", "Genuine Leather Upper", "1.2mm thickness"),
        "accessories": ("Mixed Materials", "Various", "Varies"),
    }
    default_fabric = ("Premium Fabric", "Blended fibers", "180 GSM")
    fabric_key = subcategory.lower() if subcategory else category.lower()
    fabric_info = fabric_map.get(fabric_key, fabric_map.get(category.lower(), default_fabric))

    primary_fabric = material_str if material_str else fabric_info[0]
    composition = fabric_info[1]
    weight = fabric_info[2]

    # Colors
    colors = product.get("colors", product.get("color_story", ""))

    # Design details
    details = product.get("details", [])
    details_str = ", ".join(details) if isinstance(details, list) else str(details)

    return {
        "fabric_details": {
            "primary_fabric": primary_fabric,
            "composition": composition,
            "weight": weight,
            "care_instructions": "Machine wash cold, gentle cycle. Hang dry. Do not bleach. Iron on low heat.",
        },
        "measurements": {
            "sizes": ["XS", "S", "M", "L", "XL"],
            "key_measurements": {
                "chest": {"XS": "84", "S": "88", "M": "92", "L": "96", "XL": "100"},
                "waist": {"XS": "64", "S": "68", "M": "72", "L": "76", "XL": "80"},
                "length": {"XS": "62", "S": "64", "M": "66", "L": "68", "XL": "70"},
            },
        },
        "graphics_and_prints": {
            "type": "As per design specification",
            "details": details_str or f"Per design brief — {product.get('inspiration', 'contemporary aesthetic')}",
        },
        "adornments": {
            "type": details_str if details_str else "Minimal hardware",
            "details": f"Silhouette: {product.get('silhouette', 'Classic')}. Fit: {product.get('fit', 'Regular')}.",
        },
        "construction": {
            "seam_type": "French seam / Flatlock",
            "stitch_count": "12 stitches per inch",
            "special_instructions": f"Maintain {product.get('fit', 'regular')} fit across all sizes",
        },
        "quality_control": {
            "inspection_points": [
                "Seam integrity and strength",
                "Color consistency across panels",
                "Size accuracy within 1cm tolerance",
                "Print/graphic placement accuracy",
                "Hardware functionality",
            ],
            "tolerance": "±1cm for all key measurements; ±0.5 for color delta E",
        },
        "packaging": {
            "folding_method": "Tissue-wrapped, branded fold",
            "labels": ["Woven main label", "Printed care label", "Size label", "Content label"],
            "hangtags": "Brand hangtag with product info and price",
        },
    }


def generate_techpack(product: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate a full tech pack for a fashion product using Gemini 3 Pro.
    Uses LOW thinking level — straightforward structured output.
    """
    client = get_client()

    # Build rich material info from product data
    materials_list = product.get("materials", [])
    materials_str = product.get("material", "")
    if materials_list and not materials_str:
        materials_str = ", ".join(
            m.get("name", str(m)) if isinstance(m, dict) else str(m)
            for m in materials_list
        )

    prompt = f"""You are a fashion technical designer. Generate a detailed tech pack for this product:

PRODUCT:
- Name: {product.get('name', 'Unknown')}
- Category: {product.get('category', 'Unknown')}
- Subcategory: {product.get('subcategory', '')}
- Description: {product.get('description', '')}
- Design Story: {product.get('design_story', '')}
- Material: {materials_str}
- Color Story: {product.get('color_story', '')}
- Colors: {product.get('colors', '')}
- Silhouette: {product.get('silhouette', '')}
- Fit: {product.get('fit', '')}
- Design Details: {', '.join(product.get('details', [])) if isinstance(product.get('details'), list) else product.get('details', '')}
- Inspiration: {product.get('inspiration', '')}
- Target Price: {product.get('target_price', product.get('price_tier', ''))}
- Target Persona: {product.get('target_persona', '')}

IMPORTANT: Use the material, color, and design details provided above. Do NOT use placeholder values like "To be determined" or "N/A" — infer reasonable values from the product description and category if specific data is missing.

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
        print(f"[TechPack] Generation failed: {e}, using product-aware defaults")
        return _build_default_techpack(product)
