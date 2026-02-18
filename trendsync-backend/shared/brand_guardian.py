"""
Brand Guardian — Prompt & Visual Validation
Port of brand-guardian.ts to Python, plus new visual validation via Gemini 3 Flash.
"""

import math
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple


# --------------------------------------------------------------------------
# Colour helpers
# --------------------------------------------------------------------------

def _hex_to_rgb(hex_str: str) -> Optional[Tuple[int, int, int]]:
    hex_str = hex_str.lstrip("#")
    if len(hex_str) != 6:
        return None
    try:
        return (
            int(hex_str[0:2], 16),
            int(hex_str[2:4], 16),
            int(hex_str[4:6], 16),
        )
    except ValueError:
        return None


def _color_distance(hex1: str, hex2: str) -> float:
    rgb1 = _hex_to_rgb(hex1)
    rgb2 = _hex_to_rgb(hex2)
    if rgb1 is None or rgb2 is None:
        return float("inf")
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(rgb1, rgb2)))


def _find_closest_color(
    hex_val: str, palette: List[Dict[str, str]]
) -> Optional[Dict[str, Any]]:
    if not palette:
        return None
    closest = palette[0]
    min_dist = _color_distance(hex_val, closest["hex"])
    for color in palette:
        dist = _color_distance(hex_val, color["hex"])
        if dist < min_dist:
            min_dist = dist
            closest = color
    return {**closest, "distance": min_dist}


def _extract_hex_colors(text: Optional[str]) -> List[str]:
    if not text or not isinstance(text, str):
        return []
    return re.findall(r"#[0-9A-Fa-f]{6}", text)


def _extract_focal_length(text: Optional[str]) -> Optional[int]:
    if not text or not isinstance(text, str):
        return None
    m = re.search(r"(\d+)\s*mm", text, re.IGNORECASE)
    return int(m.group(1)) if m else None


def _extract_camera_angle(text: Optional[str]) -> Optional[int]:
    if not text or not isinstance(text, str):
        return None
    m = re.search(r"(\d+)", text)
    return int(m.group(1)) if m else None


# --------------------------------------------------------------------------
# Prompt validation (rule-based, no AI needed)
# --------------------------------------------------------------------------

def validate_prompt(
    prompt: Dict[str, Any],
    brand_style: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Validate a product/image generation prompt against brand style rules.
    Returns {is_valid, compliance_score, violations, auto_fixes_available}.
    """
    violations: List[Dict[str, Any]] = []

    # --- Colour palette check ---
    color_scheme = prompt.get("color_scheme", "")
    if isinstance(color_scheme, dict):
        color_scheme = str(color_scheme)
    hex_colors = _extract_hex_colors(color_scheme)

    color_palette = brand_style.get("colorPalette", [])
    for hex_val in hex_colors:
        is_approved = any(
            _color_distance(c["hex"], hex_val) < 30 for c in color_palette
        )
        if not is_approved:
            closest = _find_closest_color(hex_val, color_palette)
            violations.append(
                {
                    "id": str(uuid.uuid4()),
                    "rule": "Color differs from brand palette (OK for trends)",
                    "category": "color",
                    "severity": "suggestion",
                    "detected": hex_val,
                    "allowed": ", ".join(
                        f"{c['name']} ({c['hex']})" for c in color_palette
                    )
                    or "No colors defined",
                    "message": f"Trend color {hex_val} differs from brand palette",
                    "autoFixAvailable": closest is not None,
                    "fixedValue": closest["hex"] if closest else None,
                }
            )

    # --- Camera settings ---
    camera = brand_style.get("cameraSettings", {})
    focal_length = _extract_focal_length(str(prompt.get("focal_length", "")))
    if focal_length is not None:
        fov = round(2 * math.atan(36 / (2 * focal_length)) * (180 / math.pi))
        fov_min = camera.get("fovMin", 20)
        fov_max = camera.get("fovMax", 80)
        if fov < fov_min or fov > fov_max:
            default_fov = camera.get("fovDefault", 50)
            suggested = round(
                36 / (2 * math.tan((default_fov * math.pi / 180) / 2))
            )
            violations.append(
                {
                    "id": str(uuid.uuid4()),
                    "rule": "Focal length must produce FOV within allowed range",
                    "category": "camera",
                    "severity": "warning",
                    "detected": f"{focal_length}mm (FOV ~{fov}°)",
                    "allowed": {"min": fov_min, "max": fov_max},
                    "message": f"Focal length {focal_length}mm produces FOV ~{fov}° outside range ({fov_min}°-{fov_max}°)",
                    "autoFixAvailable": True,
                    "fixedValue": f"{suggested}mm",
                }
            )

    angle = _extract_camera_angle(str(prompt.get("camera_angle", "")))
    if angle is not None:
        angle_min = camera.get("angleMin", 0)
        angle_max = camera.get("angleMax", 90)
        if angle < angle_min or angle > angle_max:
            violations.append(
                {
                    "id": str(uuid.uuid4()),
                    "rule": "Camera angle must be within allowed range",
                    "category": "camera",
                    "severity": "warning",
                    "detected": prompt.get("camera_angle"),
                    "allowed": {"min": angle_min, "max": angle_max},
                    "message": f"Camera angle outside range ({angle_min}°-{angle_max}°)",
                    "autoFixAvailable": True,
                    "fixedValue": f"{camera.get('angleDefault', 45)}° eye level",
                }
            )

    # --- Lighting ---
    lighting_cfg = brand_style.get("lightingConfig", {})
    lighting_raw = prompt.get("lighting", "")
    lighting_lower = (
        str(lighting_raw).lower()
        if isinstance(lighting_raw, str)
        else str(lighting_raw).lower()
    )
    color_temp = lighting_cfg.get("colorTemperature", 5000)
    if lighting_lower:
        if color_temp < 4500 and "cool" in lighting_lower:
            violations.append(
                {
                    "id": str(uuid.uuid4()),
                    "rule": "Lighting color temperature should match brand style",
                    "category": "lighting",
                    "severity": "suggestion",
                    "detected": "cool lighting",
                    "allowed": f"warm lighting ({color_temp}K)",
                    "message": f"Cool lighting detected but brand specifies warm ({color_temp}K)",
                    "autoFixAvailable": True,
                    "fixedValue": "warm, soft lighting with natural tones",
                }
            )
        elif color_temp > 5500 and "warm" in lighting_lower:
            violations.append(
                {
                    "id": str(uuid.uuid4()),
                    "rule": "Lighting color temperature should match brand style",
                    "category": "lighting",
                    "severity": "suggestion",
                    "detected": "warm lighting",
                    "allowed": f"cool lighting ({color_temp}K)",
                    "message": f"Warm lighting detected but brand specifies cool ({color_temp}K)",
                    "autoFixAvailable": True,
                    "fixedValue": "cool, neutral studio lighting",
                }
            )

    # --- Negative prompts ---
    negative_prompts = brand_style.get("negativePrompts", [])
    description_raw = prompt.get("description", "")
    description_lower = (
        str(description_raw).lower()
        if isinstance(description_raw, str)
        else str(description_raw).lower()
    )

    for neg in negative_prompts:
        if description_lower and neg.lower() in description_lower:
            violations.append(
                {
                    "id": str(uuid.uuid4()),
                    "rule": "Description must not contain forbidden terms",
                    "category": "prompt",
                    "severity": "critical",
                    "detected": neg,
                    "allowed": "Not allowed: " + ", ".join(negative_prompts),
                    "message": f'Description contains forbidden term: "{neg}"',
                    "autoFixAvailable": True,
                    "fixedValue": re.sub(neg, "", str(description_raw), flags=re.IGNORECASE).strip(),
                }
            )

    current_negatives = (prompt.get("negative_prompt") or "").lower()
    for neg in negative_prompts:
        if neg.lower() not in current_negatives:
            violations.append(
                {
                    "id": str(uuid.uuid4()),
                    "rule": "Negative prompt must include brand exclusions",
                    "category": "prompt",
                    "severity": "warning",
                    "detected": "Missing: " + neg,
                    "allowed": ", ".join(negative_prompts),
                    "message": f'Missing required negative prompt: "{neg}"',
                    "autoFixAvailable": True,
                    "fixedValue": neg,
                }
            )

    # --- Objects check ---
    for obj in prompt.get("objects", []):
        obj_desc = str(obj.get("description", "")).lower()
        for neg in negative_prompts:
            if neg.lower() in obj_desc:
                violations.append(
                    {
                        "id": str(uuid.uuid4()),
                        "rule": "Object description must not contain forbidden terms",
                        "category": "prompt",
                        "severity": "critical",
                        "detected": f'"{neg}" in object "{obj.get("name", "")}"',
                        "allowed": "Not allowed: " + ", ".join(negative_prompts),
                        "message": f'Object "{obj.get("name", "")}" contains forbidden term: "{neg}"',
                        "autoFixAvailable": True,
                        "fixedValue": re.sub(neg, "", str(obj.get("description", "")), flags=re.IGNORECASE).strip(),
                    }
                )

    # --- Scoring ---
    critical = sum(1 for v in violations if v["severity"] == "critical")
    warning = sum(1 for v in violations if v["severity"] == "warning")
    suggestion = sum(1 for v in violations if v["severity"] == "suggestion")

    score = max(0, min(100, 100 - critical * 25 - warning * 10 - suggestion * 3))

    return {
        "is_valid": critical == 0,
        "compliance_score": score,
        "violations": violations,
        "auto_fixes_available": sum(1 for v in violations if v.get("autoFixAvailable")),
    }


def get_compliance_badge(score: int) -> Dict[str, str]:
    if score >= 90:
        return {"label": "Excellent", "color": "text-emerald-400", "bgColor": "bg-emerald-500/20"}
    if score >= 75:
        return {"label": "Good", "color": "text-green-400", "bgColor": "bg-green-500/20"}
    if score >= 60:
        return {"label": "Fair", "color": "text-amber-400", "bgColor": "bg-amber-500/20"}
    if score >= 40:
        return {"label": "Poor", "color": "text-orange-400", "bgColor": "bg-orange-500/20"}
    return {"label": "Critical", "color": "text-red-400", "bgColor": "bg-red-500/20"}
