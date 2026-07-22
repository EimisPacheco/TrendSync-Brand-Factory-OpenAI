"""
Regression guard for the surgical-vs-global edit classifier used by
shared/image_generator.py edit_product_image.

The bug: Lux (the OpenAI Agents SDK design companion) rephrases the user's
instruction before calling the edit_product_image tool. The original
classifier only recognised "from X to Y" / "swap X for Y" / "replace the X"
as surgical signals. Lux's rephrasings ("change all off-white areas to black
while preserving the red upper", "specifically the sole/midsole", etc.)
matched none of those, so the classifier defaulted to GLOBAL recolor. The
whole shoe came back black.

The fix:
  • Expand surgical_markers to include preservation/scope language
    ("preserv", "intact", "untouched", "leave ", " areas ", "specifically", …)
    so AI-rephrased instructions classify correctly.
  • Add a "two-color naming" detection — short voice phrasings like
    "change off-white to black" name source AND target without a "from"
    connector, and that's also a surgical signal.
  • Surgical signal always wins over global markers, so phrases like
    "leave everything else intact" stay surgical even though they contain
    the word "everything".

Both the text agent (Lux) and the voice agent (gpt-realtime-2.1) feed
edit_instruction into the same classifier via /edit-image and
shared.image_generator.edit_product_image, so this test guards both paths.

Run with: pytest trendsync-backend/tests/test_edit_classifier.py
"""

from __future__ import annotations

from shared.image_generator import _classify_edit_instruction


# ----- Tests ----------------------------------------------------------------

# (instruction, expected_mode, source_path)
CASES = [
    # User-typed (raw UI input that goes to Lux)
    ("Change the color from Off white (#E8E3D7) to black", "SURGICAL", "ui-typed"),
    ("Change the color from Chocolate Brown to orange", "SURGICAL", "ui-typed"),
    # Lux's rephrasings that the original classifier missed
    (
        "Change all Off white (#E8E3D7) areas of the shoe, specifically the "
        "sole/midsole and any matching off-white trim, to solid black while "
        "preserving the existing red and orange upper, texture, stitching, "
        "lighting, and proportions.",
        "SURGICAL",
        "lux-rephrased",
    ),
    ("Recolor only the sole to black; keep the upper unchanged", "SURGICAL", "lux-rephrased"),
    ("Turn the off-white parts black, leave everything else intact", "SURGICAL", "lux-rephrased"),
    ("Make the whole upper black but keep the sole", "SURGICAL", "lux-rephrased"),
    # Voice-style verbatim (no AI rephrasing, just transcription)
    ("change off-white to black", "SURGICAL", "voice"),
    ("change the off-white to black", "SURGICAL", "voice"),
    ("change off white to black", "SURGICAL", "voice"),
    ("change navy to red", "SURGICAL", "voice"),
    ("swap blue for green", "SURGICAL", "voice"),
    ("change brown into gold", "SURGICAL", "voice"),
    # Global / single-color naming
    ("Make it orange", "GLOBAL", "global"),
    ("Make the whole sneaker orange", "GLOBAL", "global"),
    ("Make everything blue", "GLOBAL", "global"),
    ("Change to red", "GLOBAL", "global"),
    ("Recolor everything to navy", "GLOBAL", "global"),
    ("Completely change to navy", "GLOBAL", "global"),
    # Non-color edits
    ("Make it longer in the back", "OTHER", "other"),
    ("Add a pocket on the left side", "OTHER", "other"),
]


def test_each_case():
    failures = []
    for instr, want, source in CASES:
        got = _classify_edit_instruction(instr).upper()
        if got != want:
            failures.append((source, want, got, instr))
    assert not failures, (
        "Classifier regressions:\n"
        + "\n".join(f"  [{s}] expected={w} got={g} | {i!r}" for s, w, g, i in failures)
    )


if __name__ == "__main__":
    test_each_case()
    print(f"OK — {len(CASES)} cases pass")
