import { NextRequest, NextResponse } from "next/server";
import { runVisualReasoningAgent } from "../../../lib/gemini-visual";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imageBase64Jpeg = typeof body.imageBase64Jpeg === "string" ? body.imageBase64Jpeg : "";
    const sceneDialogue = typeof body.sceneDialogue === "string" ? body.sceneDialogue : "";
    const scenePrompt = typeof body.scenePrompt === "string" ? body.scenePrompt : "";
    const task = typeof body.task === "string" ? body.task : undefined;
    const expectedResponse = typeof body.expectedResponse === "string" ? body.expectedResponse : undefined;

    if (!imageBase64Jpeg) {
      return NextResponse.json(
        { error: "imageBase64Jpeg is required" },
        { status: 400 },
      );
    }

    const result = await runVisualReasoningAgent({
      imageBase64Jpeg,
      sceneDialogue,
      scenePrompt,
      task,
      expectedResponse,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("/api/visual-agent error", err);
    return NextResponse.json(
      { error: "Failed to run visual reasoning agent" },
      { status: 500 },
    );
  }
}
