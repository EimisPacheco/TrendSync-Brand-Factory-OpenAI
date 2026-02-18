"""
TrendSync Backend — Comprehensive Unit Tests
Tests all shared modules + FastAPI service accessibility.
Run with: cd trendsync-backend && source .venv/bin/activate && python -m pytest tests/test_all.py -v
"""

import sys
import os
import json
import importlib
import inspect

import pytest

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# =====================================================================
# 1. SHARED MODULE IMPORT TESTS — verify every module loads without error
# =====================================================================

class TestModuleImports:
    """Every shared module must be importable."""

    def test_import_brand_guardian(self):
        mod = importlib.import_module("shared.brand_guardian")
        assert hasattr(mod, "validate_prompt")
        assert hasattr(mod, "get_compliance_badge")

    def test_import_trend_engine(self):
        mod = importlib.import_module("shared.trend_engine")
        assert hasattr(mod, "fetch_trends")
        assert hasattr(mod, "fetch_celebrity_list")

    def test_import_image_generator(self):
        mod = importlib.import_module("shared.image_generator")
        assert hasattr(mod, "generate_product_image")
        assert hasattr(mod, "edit_product_image")

    def test_import_collection_engine(self):
        mod = importlib.import_module("shared.collection_engine")
        assert hasattr(mod, "generate_collection")
        assert hasattr(mod, "validate_collection_schema")

    def test_import_techpack_generator(self):
        mod = importlib.import_module("shared.techpack_generator")
        assert hasattr(mod, "generate_techpack")
        assert hasattr(mod, "DEFAULT_TECHPACK")

    def test_import_ad_video_engine(self):
        mod = importlib.import_module("shared.ad_video_engine")
        assert hasattr(mod, "generate_ad_storyboard")
        assert hasattr(mod, "generate_complete_ad_video")
        assert hasattr(mod, "validate_storyboard")
        assert hasattr(mod, "convert_to_veo_request")


# =====================================================================
# 2. BRAND GUARDIAN — pure logic, no API calls needed
# =====================================================================

class TestBrandGuardian:
    """Test the rule-based brand validation engine."""

    @pytest.fixture
    def brand_style(self):
        return {
            "colorPalette": [
                {"id": "1", "name": "Navy", "hex": "#1E2A4A"},
                {"id": "2", "name": "Soft Pink", "hex": "#E8A0BF"},
                {"id": "3", "name": "Cloud White", "hex": "#F5F5F5"},
            ],
            "cameraSettings": {
                "fovMin": 20,
                "fovMax": 80,
                "fovDefault": 50,
                "angleMin": 0,
                "angleMax": 45,
                "angleDefault": 15,
            },
            "lightingConfig": {
                "colorTemperature": 5000,
                "keyLightIntensity": 80,
            },
            "negativePrompts": ["low quality", "blurry", "cartoon", "watermark"],
        }

    def test_valid_prompt_passes(self, brand_style):
        from shared.brand_guardian import validate_prompt

        prompt = {
            "description": "A navy blazer with clean lines",
            "color_scheme": "#1E2A4A navy",
            "lighting": "warm studio lighting",
            "camera_angle": "15 degree",
            "focal_length": "85mm",
            "negative_prompt": "low quality, blurry, cartoon, watermark",
            "objects": [],
        }
        result = validate_prompt(prompt, brand_style)
        assert result["is_valid"] is True
        assert result["compliance_score"] >= 80

    def test_forbidden_term_detected(self, brand_style):
        from shared.brand_guardian import validate_prompt

        prompt = {
            "description": "A low quality cartoon dress",
            "color_scheme": "",
            "lighting": "",
            "camera_angle": "",
            "focal_length": "",
            "negative_prompt": "",
            "objects": [],
        }
        result = validate_prompt(prompt, brand_style)
        assert result["is_valid"] is False
        critical = [v for v in result["violations"] if v["severity"] == "critical"]
        assert len(critical) >= 1
        messages = [v["message"] for v in critical]
        assert any("low quality" in m for m in messages)

    def test_missing_negative_prompts(self, brand_style):
        from shared.brand_guardian import validate_prompt

        prompt = {
            "description": "A nice blazer",
            "color_scheme": "",
            "lighting": "",
            "camera_angle": "",
            "focal_length": "",
            "negative_prompt": "",
            "objects": [],
        }
        result = validate_prompt(prompt, brand_style)
        warnings = [v for v in result["violations"] if v["severity"] == "warning"]
        assert len(warnings) >= 4  # each missing negative prompt

    def test_off_palette_color_is_suggestion(self, brand_style):
        from shared.brand_guardian import validate_prompt

        prompt = {
            "description": "A dress",
            "color_scheme": "#FF0000 red",
            "lighting": "",
            "camera_angle": "",
            "focal_length": "",
            "negative_prompt": "low quality, blurry, cartoon, watermark",
            "objects": [],
        }
        result = validate_prompt(prompt, brand_style)
        suggestions = [v for v in result["violations"] if v["severity"] == "suggestion"]
        assert len(suggestions) >= 1
        assert any("color" in v["category"] for v in suggestions)

    def test_compliance_score_calculation(self, brand_style):
        from shared.brand_guardian import validate_prompt

        # Perfect prompt
        prompt = {
            "description": "Navy blazer",
            "color_scheme": "#1E2A4A",
            "lighting": "neutral lighting",
            "camera_angle": "15 degree",
            "focal_length": "85mm",
            "negative_prompt": "low quality, blurry, cartoon, watermark",
            "objects": [],
        }
        result = validate_prompt(prompt, brand_style)
        assert 0 <= result["compliance_score"] <= 100

    def test_auto_fix_available(self, brand_style):
        from shared.brand_guardian import validate_prompt

        prompt = {
            "description": "A low quality dress",
            "color_scheme": "",
            "lighting": "",
            "camera_angle": "",
            "focal_length": "",
            "negative_prompt": "",
            "objects": [],
        }
        result = validate_prompt(prompt, brand_style)
        assert result["auto_fixes_available"] > 0

    def test_object_violation(self, brand_style):
        from shared.brand_guardian import validate_prompt

        prompt = {
            "description": "A dress",
            "color_scheme": "",
            "lighting": "",
            "camera_angle": "",
            "focal_length": "",
            "negative_prompt": "low quality, blurry, cartoon, watermark",
            "objects": [
                {"name": "dress", "description": "A blurry cartoon dress"},
            ],
        }
        result = validate_prompt(prompt, brand_style)
        obj_violations = [v for v in result["violations"] if "Object" in v["rule"]]
        assert len(obj_violations) >= 1

    def test_compliance_badge(self):
        from shared.brand_guardian import get_compliance_badge

        assert get_compliance_badge(95)["label"] == "Excellent"
        assert get_compliance_badge(80)["label"] == "Good"
        assert get_compliance_badge(65)["label"] == "Fair"
        assert get_compliance_badge(45)["label"] == "Poor"
        assert get_compliance_badge(20)["label"] == "Critical"

    def test_focal_length_violation(self, brand_style):
        from shared.brand_guardian import validate_prompt

        prompt = {
            "description": "A blazer",
            "color_scheme": "",
            "lighting": "",
            "camera_angle": "",
            "focal_length": "10mm",  # Very wide — should violate
            "negative_prompt": "low quality, blurry, cartoon, watermark",
            "objects": [],
        }
        result = validate_prompt(prompt, brand_style)
        camera_violations = [v for v in result["violations"] if v["category"] == "camera"]
        assert len(camera_violations) >= 1

    def test_lighting_mismatch(self, brand_style):
        from shared.brand_guardian import validate_prompt

        # Brand has 5000K (neutral) — set brand to warm (4000K) and send cool lighting
        warm_brand = {**brand_style}
        warm_brand["lightingConfig"] = {"colorTemperature": 4000, "keyLightIntensity": 80}

        prompt = {
            "description": "A dress",
            "color_scheme": "",
            "lighting": "cool fluorescent lighting",
            "camera_angle": "",
            "focal_length": "",
            "negative_prompt": "low quality, blurry, cartoon, watermark",
            "objects": [],
        }
        result = validate_prompt(prompt, warm_brand)
        lighting_v = [v for v in result["violations"] if v["category"] == "lighting"]
        assert len(lighting_v) >= 1


# =====================================================================
# 3. COLLECTION ENGINE — schema validation (no API calls)
# =====================================================================

class TestCollectionEngine:
    """Test collection schema validation."""

    def test_valid_collection_passes(self):
        from shared.collection_engine import validate_collection_schema

        collection = {
            "collection_id": "col_123",
            "name": "Spring Collection",
            "description": "A spring collection",
            "season": "Spring 2025",
            "products": [
                {
                    "name": f"Product {i}",
                    "category": "tops",
                    "description": "A nice top",
                    "color_story": "#1E2A4A with #E8A0BF",
                    "material": "Cotton",
                    "target_price": "$50 - $100",
                    "image_prompt": "Professional product photo of a cotton top",
                }
                for i in range(6)
            ],
        }
        is_valid, errors = validate_collection_schema(collection, 6)
        assert is_valid is True
        assert len(errors) == 0

    def test_wrong_product_count(self):
        from shared.collection_engine import validate_collection_schema

        collection = {
            "collection_id": "col_123",
            "name": "Test",
            "description": "Test",
            "season": "Spring 2025",
            "products": [{"name": "P1", "category": "tops", "description": "X", "color_story": "", "material": "", "target_price": "", "image_prompt": ""}],
        }
        is_valid, errors = validate_collection_schema(collection, 6)
        assert is_valid is False
        assert any("Expected 6" in e for e in errors)

    def test_missing_required_fields(self):
        from shared.collection_engine import validate_collection_schema

        collection = {"products": [{"name": "P1"}]}
        is_valid, errors = validate_collection_schema(collection, 1)
        assert is_valid is False
        assert len(errors) > 0

    def test_product_missing_fields(self):
        from shared.collection_engine import validate_collection_schema

        collection = {
            "collection_id": "col_123",
            "name": "Test",
            "description": "Test",
            "season": "Spring 2025",
            "products": [{"name": "P1"}],  # missing most fields
        }
        is_valid, errors = validate_collection_schema(collection, 1)
        assert is_valid is False
        assert any("image_prompt" in e for e in errors)


# =====================================================================
# 4. AD VIDEO ENGINE — storyboard validation (no API calls)
# =====================================================================

class TestAdVideoEngine:
    """Test ad video storyboard validation."""

    def test_valid_storyboard_passes(self):
        from shared.ad_video_engine import validate_storyboard

        storyboard = {
            "ad_id": "ad_123",
            "title": "Test Ad",
            "description": "A test advertisement",
            "scenes": [
                {
                    "scene_number": i + 1,
                    "scene_type": ["hook", "hero", "detail", "lifestyle", "cta"][i],
                    "prompt": f"Scene {i + 1} prompt",
                    "voiceover": f"Scene {i + 1} voiceover",
                }
                for i in range(5)
            ],
        }
        is_valid, errors = validate_storyboard(storyboard)
        assert is_valid is True
        assert len(errors) == 0

    def test_wrong_scene_count(self):
        from shared.ad_video_engine import validate_storyboard

        storyboard = {
            "ad_id": "ad_123",
            "title": "Test",
            "description": "Test",
            "scenes": [
                {"scene_number": 1, "scene_type": "hook", "prompt": "X", "voiceover": "Y"},
            ],
        }
        is_valid, errors = validate_storyboard(storyboard)
        assert is_valid is False
        assert any("Expected 5" in e for e in errors)

    def test_missing_scene_fields(self):
        from shared.ad_video_engine import validate_storyboard

        storyboard = {
            "ad_id": "ad_123",
            "title": "Test",
            "description": "Test",
            "scenes": [{"scene_number": i} for i in range(1, 6)],
        }
        is_valid, errors = validate_storyboard(storyboard)
        assert is_valid is False
        assert any("scene_type" in e for e in errors)

    def test_convert_to_veo_request(self):
        from shared.ad_video_engine import convert_to_veo_request

        storyboard = {
            "scenes": [
                {"prompt": "Scene 1", "voiceover": "Hello", "scene_type": "hook"},
                {"prompt": "Scene 2", "voiceover": None, "scene_type": "hero"},
            ],
        }
        request = convert_to_veo_request(storyboard)
        assert "scenes" in request
        assert len(request["scenes"]) == 2
        assert request["scenes"][0]["prompt"] == "Scene 1"
        assert request["scenes"][0]["dialogue"] == "Hello"
        assert request["duration_seconds"] == 8
        assert request["aspect_ratio"] == "16:9"
        assert request["generate_audio"] is True

    def test_convert_with_product_image(self):
        from shared.ad_video_engine import convert_to_veo_request

        storyboard = {"scenes": [{"prompt": "S1", "voiceover": "V1", "scene_type": "hero"}]}
        request = convert_to_veo_request(storyboard, product_image_base64="abc123")
        assert request["style_reference_image_base64"] == "abc123"


# =====================================================================
# 5. TECHPACK GENERATOR — default fallback
# =====================================================================

class TestTechpackGenerator:
    """Test techpack module loads and has valid defaults."""

    def test_default_techpack_structure(self):
        from shared.techpack_generator import DEFAULT_TECHPACK

        assert "fabric_details" in DEFAULT_TECHPACK
        assert "measurements" in DEFAULT_TECHPACK
        assert "construction" in DEFAULT_TECHPACK
        assert "quality_control" in DEFAULT_TECHPACK
        assert "packaging" in DEFAULT_TECHPACK
        assert "graphics_and_prints" in DEFAULT_TECHPACK
        assert "adornments" in DEFAULT_TECHPACK

    def test_default_techpack_has_sizes(self):
        from shared.techpack_generator import DEFAULT_TECHPACK

        sizes = DEFAULT_TECHPACK["measurements"]["sizes"]
        assert "S" in sizes
        assert "M" in sizes
        assert "L" in sizes


# =====================================================================
# 6. TREND ENGINE — function signatures (no API calls)
# =====================================================================

class TestTrendEngine:
    """Test trend engine function signatures and helpers."""

    def test_fetch_trends_signature(self):
        from shared.trend_engine import fetch_trends

        sig = inspect.signature(fetch_trends)
        params = list(sig.parameters.keys())
        assert "season" in params
        assert "region" in params
        assert "demographic" in params
        assert "trend_source" in params

    def test_fetch_celebrity_list_signature(self):
        from shared.trend_engine import fetch_celebrity_list

        sig = inspect.signature(fetch_celebrity_list)
        params = list(sig.parameters.keys())
        assert "demographic" in params

    def test_prompt_builders_exist(self):
        from shared import trend_engine

        assert hasattr(trend_engine, "_build_celebrity_prompt")
        assert hasattr(trend_engine, "_build_regional_prompt")

    def test_celebrity_prompt_contains_demographic(self):
        from shared.trend_engine import _build_celebrity_prompt

        prompt = _build_celebrity_prompt("Gen Z")
        assert "Gen Z" in prompt
        assert "JSON" in prompt

    def test_regional_prompt_contains_config(self):
        from shared.trend_engine import _build_regional_prompt

        prompt = _build_regional_prompt("Summer 2025", "EU", "Luxury")
        assert "Summer 2025" in prompt
        assert "EU" in prompt
        assert "Luxury" in prompt


# =====================================================================
# 7. IMAGE GENERATOR — function signatures
# =====================================================================

class TestImageGenerator:
    """Test image generator module structure."""

    def test_generate_product_image_signature(self):
        from shared.image_generator import generate_product_image

        sig = inspect.signature(generate_product_image)
        params = list(sig.parameters.keys())
        assert "product_description" in params
        assert "category" in params
        assert "brand_style" in params

    def test_edit_product_image_signature(self):
        from shared.image_generator import edit_product_image

        sig = inspect.signature(edit_product_image)
        params = list(sig.parameters.keys())
        assert "image_base64" in params
        assert "edit_instruction" in params


# =====================================================================
# 8. FASTAPI SERVICES — route accessibility
# =====================================================================

class TestMainBackendRoutes:
    """Test main backend FastAPI app loads and routes are registered."""

    @pytest.fixture
    def app(self):
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "main-backend"))
        from services.main_backend_app import app
        return app

    def test_app_loads(self):
        # Import the app module directly
        spec = importlib.util.find_spec("services.main-backend.main")
        # FastAPI modules sometimes don't import via dots because of hyphens
        # So we'll use importlib with the actual file path
        import importlib.util as iu
        main_path = os.path.join(os.path.dirname(__file__), "..", "services", "main-backend", "main.py")
        spec = iu.spec_from_file_location("main_backend_main", main_path)
        mod = iu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert hasattr(mod, "app")
        app = mod.app
        # Check routes exist
        routes = [r.path for r in app.routes]
        assert "/health" in routes
        assert "/trends" in routes
        assert "/generate-collection" in routes
        assert "/generate-image" in routes
        assert "/edit-image" in routes
        assert "/validate" in routes
        assert "/generate-techpack" in routes
        assert "/generate-ad-video" in routes
        assert "/collections" in routes

    def test_all_http_methods(self):
        import importlib.util as iu
        main_path = os.path.join(os.path.dirname(__file__), "..", "services", "main-backend", "main.py")
        spec = iu.spec_from_file_location("main_backend_main2", main_path)
        mod = iu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        app = mod.app

        route_map = {}
        for route in app.routes:
            if hasattr(route, "methods"):
                route_map[route.path] = route.methods

        # POST endpoints
        assert "POST" in route_map.get("/trends", set())
        assert "POST" in route_map.get("/generate-collection", set())
        assert "POST" in route_map.get("/generate-image", set())
        assert "POST" in route_map.get("/edit-image", set())
        assert "POST" in route_map.get("/validate", set())
        assert "POST" in route_map.get("/generate-techpack", set())
        assert "POST" in route_map.get("/generate-ad-video", set())

        # GET endpoints
        assert "GET" in route_map.get("/health", set())
        assert "GET" in route_map.get("/collections", set())


class TestVideoGenServiceRoutes:
    """Test video gen service loads and routes are registered."""

    def test_app_loads_and_routes(self):
        import importlib.util as iu
        path = os.path.join(os.path.dirname(__file__), "..", "services", "video-gen-service", "main.py")
        spec = iu.spec_from_file_location("video_gen_main", path)
        mod = iu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert hasattr(mod, "app")

        routes = [r.path for r in mod.app.routes]
        assert "/health" in routes
        assert "/generate-ad" in routes

        # Check POST method
        for route in mod.app.routes:
            if hasattr(route, "path") and route.path == "/generate-ad":
                assert "POST" in route.methods


class TestVoiceCompanionRoutes:
    """Test voice companion service loads, routes exist, and all 7 tools are registered."""

    def _load_module(self):
        import importlib.util as iu
        path = os.path.join(os.path.dirname(__file__), "..", "services", "voice-companion", "main.py")
        spec = iu.spec_from_file_location("voice_companion_main", path)
        mod = iu.module_from_spec(spec)
        # Set LOCATION to avoid ValueError
        os.environ["GOOGLE_CLOUD_LOCATION"] = "us-central1"
        spec.loader.exec_module(mod)
        return mod

    def test_app_loads(self):
        mod = self._load_module()
        assert hasattr(mod, "app")
        assert hasattr(mod, "agent")

    def test_health_route(self):
        mod = self._load_module()
        routes = [r.path for r in mod.app.routes]
        assert "/health" in routes

    def test_websocket_route(self):
        mod = self._load_module()
        routes = [r.path for r in mod.app.routes]
        assert "/ws/voice-companion/{session_id}" in routes

    def test_agent_has_7_tools(self):
        mod = self._load_module()
        agent = mod.agent
        assert len(agent.tools) == 7

    def test_all_tools_are_callable(self):
        mod = self._load_module()
        tool_names = []
        for tool in mod.agent.tools:
            if callable(tool):
                tool_names.append(tool.__name__)
        
        expected = [
            "adjust_design",
            "fetch_trend_info",
            "validate_design",
            "generate_variation",
            "generate_ad_video",
            "navigate_to_page",
            "start_collection_generation",
        ]
        for name in expected:
            assert name in tool_names, f"Missing tool: {name}"

    def test_navigate_tool_returns_route(self):
        mod = self._load_module()
        result = mod.navigate_to_page("dashboard")
        assert result["action"] == "navigate"
        assert result["status"] == "success"
        assert result["route"] == "/dashboard"

    def test_navigate_tool_unknown_page(self):
        mod = self._load_module()
        result = mod.navigate_to_page("nonexistent")
        assert result["status"] == "unknown_page"
        assert "available_pages" in result

    def test_navigate_tool_all_pages(self):
        mod = self._load_module()
        pages = {
            "dashboard": "/dashboard",
            "brand style": "/brand-style",
            "brand editor": "/brand-style",
            "brand guardian": "/brand-guardian",
            "validation": "/brand-guardian",
            "collection": "/collection",
            "trends": "/trends",
            "settings": "/settings",
        }
        for page_name, expected_route in pages.items():
            result = mod.navigate_to_page(page_name)
            assert result["route"] == expected_route, f"navigate_to_page('{page_name}') expected route '{expected_route}' but got '{result.get('route')}'"


# =====================================================================
# 9. INTEGRATION — cross-module compatibility
# =====================================================================

class TestCrossModuleIntegration:
    """Test that modules work together correctly."""

    def test_collection_engine_uses_brand_guardian_types(self):
        """Ensure the data structures are compatible."""
        from shared.brand_guardian import validate_prompt
        from shared.collection_engine import validate_collection_schema

        # A product from collection engine should be validatable by brand guardian
        product_prompt = {
            "description": "Cotton blazer with navy blue color",
            "color_scheme": "#1E2A4A navy",
            "lighting": "studio",
            "camera_angle": "15 degree",
            "focal_length": "85mm",
            "negative_prompt": "low quality",
            "objects": [],
        }
        brand_style = {
            "colorPalette": [{"id": "1", "name": "Navy", "hex": "#1E2A4A"}],
            "cameraSettings": {"fovMin": 20, "fovMax": 80, "fovDefault": 50, "angleMin": 0, "angleMax": 45, "angleDefault": 15},
            "lightingConfig": {"colorTemperature": 5000},
            "negativePrompts": ["low quality"],
        }
        result = validate_prompt(product_prompt, brand_style)
        assert "compliance_score" in result
        assert "violations" in result

    def test_ad_video_engine_veo_request_format(self):
        """Ensure Veo request format matches video-gen-service expectations."""
        from shared.ad_video_engine import convert_to_veo_request

        storyboard = {
            "scenes": [
                {"prompt": f"Scene {i}", "voiceover": f"VO {i}", "scene_type": "hero"}
                for i in range(5)
            ],
        }
        request = convert_to_veo_request(storyboard, "base64img")

        # Matches GenerateAdRequest in video-gen-service
        assert "scenes" in request
        assert isinstance(request["scenes"], list)
        for scene in request["scenes"]:
            assert "prompt" in scene
            assert "dialogue" in scene  # voiceover mapped to dialogue
            assert "interaction" in scene
        assert "duration_seconds" in request
        assert "aspect_ratio" in request
        assert "generate_audio" in request
        assert "style_reference_image_base64" in request
