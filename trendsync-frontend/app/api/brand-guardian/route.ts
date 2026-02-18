import { NextRequest, NextResponse } from "next/server";
import { runBrandGuardianVisual } from "@/lib/gemini-visual";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imageBase64Jpeg =
      typeof body.imageBase64Jpeg === "string" ? body.imageBase64Jpeg : "";
    const brandStyleDescription =
      typeof body.brandStyleDescription === "string"
        ? body.brandStyleDescription
        : "";

    if (!imageBase64Jpeg) {
      return NextResponse.json(
        { error: "imageBase64Jpeg is required" },
        { status: 400 }
      );
    }

    const result = await runBrandGuardianVisual({
      imageBase64Jpeg,
      brandStyleDescription,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("/api/brand-guardian error", err);
    return NextResponse.json(
      { error: "Failed to run brand guardian visual agent" },
      { status: 500 }
    );
  }
}
