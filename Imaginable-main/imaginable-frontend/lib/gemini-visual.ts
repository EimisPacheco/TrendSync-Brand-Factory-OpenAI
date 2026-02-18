/**
 * Visual Multimodal Reasoning Agent 
 */

import { GoogleGenAI, Tool, Type } from "@google/genai";

export const VISUAL_MODEL_NAME = "gemini-3-flash-preview";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

if (!GEMINI_API_KEY) {
  console.warn(
    "[VisualReasoningAgent] Missing GEMINI_API_KEY. Set it in your server env."
  );
}

let visualClient: GoogleGenAI | null = null;

export const getVisualClient = () => {
  if (!visualClient) {
    visualClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return visualClient;
};

export type EvalBranch = "correct" | "incorrect";

export type VisualAgentResult = {
  branch: EvalBranch | null;
  feedbackSentence: string | null;
};

export const VISUAL_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "evaluate_scene_drawing",
        description:
          "Evaluate the user's drawing on top of the current video frame and decide whether it correctly completes the task implied by the scene dialogue.",
        parameters: {
          type: Type.OBJECT,
          required: ["branch", "feedback_sentence"],
          properties: {
            branch: {
              type: Type.STRING,
              enum: ["correct", "incorrect"],
              description:
                "Which feedback branch to trigger based on the drawing: must be either 'correct' or 'incorrect'.",
            },
            feedback_sentence: {
              type: Type.STRING,
              description:
                "A single, short sentence of feedback for the user, personalized to what they actually drew.",
            },
          },
        },
      },
    ],
  },
];

export const SYSTEM_INSTRUCTION_VISUAL = `You are the Visual Reasoning Agent for an interactive educational cartoon.

The user can draw or write directly on top of a paused video frame. You see:
- The video frame with the scene context.
- The user's drawing or writing on top.
- The scene's dialogue text, which usually states the task (for example: "Can you draw an apple on the board?" or "Can you spell the word banana?").

Your job is to:
1) Infer the target task from the dialogue text.
2) Look carefully at the drawing and decide if the user has successfully completed the task.
3) Call the evaluate_scene_drawing tool with:
   - branch: 'correct' if the user completed the task well enough, otherwise 'incorrect'.
   - feedback_sentence: exactly ONE short sentence of feedback, personalized and concrete.

Rules:
- You MUST always call the evaluate_scene_drawing tool.
- Be generous but honest: small imperfections are okay for 'correct' if the user's intent is very clear.
- Feedback MUST be specific to what the user drew or wrote (avoid generic lines like "Good job" without details).
- If branch is 'correct', make feedback_sentence enthusiastic and affirming.
- If branch is 'incorrect', be kind and precise about what is missing/wrong, and hint how to improve.
- Return only one tool call (evaluate_scene_drawing).
`;


type EvaluateSceneDrawingArgs = {
  branch?: unknown;
  feedback_sentence?: unknown;
};

type FunctionCall = {
  name: string;
  args?: unknown;
};

type ResponseWithFunctionCalls = {
  functionCalls?: FunctionCall[];
};

function normalizeBranch(value: unknown): EvalBranch | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  return v === "correct" || v === "incorrect" ? (v as EvalBranch) : null;
}

function normalizeFeedback(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return s.replace(/\s*\n+\s*/g, " ");
}

function extractEvaluateSceneDrawingCall(
  response: unknown
): { branch: EvalBranch | null; feedbackSentence: string | null } {
  const functionCalls =
    (response as unknown as ResponseWithFunctionCalls).functionCalls ?? [];

  for (const call of functionCalls) {
    if (call.name !== "evaluate_scene_drawing") continue;

    const args = (call.args ?? {}) as EvaluateSceneDrawingArgs;

    const branch = normalizeBranch(args.branch);
    const feedbackSentence = normalizeFeedback(args.feedback_sentence);

    return { branch, feedbackSentence };
  }

  return { branch: null, feedbackSentence: null };
}

// ---- Main runner ----

export async function runVisualReasoningAgent(params: {
  imageBase64Jpeg: string; 
  sceneDialogue: string;
  scenePrompt?: string;
  task?: string;
  expectedResponse?: string;
}): Promise<VisualAgentResult> {
  const { imageBase64Jpeg, sceneDialogue, scenePrompt, task, expectedResponse } = params;

  if (!imageBase64Jpeg || typeof imageBase64Jpeg !== "string") {
    return { branch: null, feedbackSentence: null };
  }

  const ai = getVisualClient();

  const response = await ai.models.generateContent({
    model: VISUAL_MODEL_NAME,
    contents: [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64Jpeg,
        },
      },
      {
        text: [
          "You are seeing a frame from an educational cartoon with the child's drawing on top.",
          "Below is the scene information that describes the task:",
          "",
          "Scene prompt:",
          scenePrompt ?? "",
          "",
          "Scene dialogue:",
          sceneDialogue,
          "",
          task ? "=== TASK DEFINITION ===" : "",
          task ? `Task: ${task}` : "",
          task ? "" : "",
          expectedResponse ? "=== EXPECTED RESPONSE ===" : "",
          expectedResponse ? `What counts as correct: ${expectedResponse}` : "",
          expectedResponse ? "" : "",
          task || expectedResponse ? "Use the task definition and expected response criteria above to guide your evaluation." : "Infer the intended task from the dialogue and scene prompt.",
          "",
          "Now call evaluate_scene_drawing with:",
          "- branch: 'correct' or 'incorrect' based on whether the child completed the task.",
          "- feedback_sentence: exactly ONE short, personalized sentence of feedback.",
        ].filter(line => line !== null).join("\n"),
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION_VISUAL,
      tools: VISUAL_TOOLS,
      temperature: 0.2,
    },
  });

  const { branch, feedbackSentence } = extractEvaluateSceneDrawingCall(response);

  if (!branch || !feedbackSentence) {
    return {
      branch: branch ?? "incorrect",
      feedbackSentence:
        feedbackSentence ??
        "I couldn’t quite tell what you drew—try making it a little clearer.",
    };
  }

  return { branch, feedbackSentence };
}
