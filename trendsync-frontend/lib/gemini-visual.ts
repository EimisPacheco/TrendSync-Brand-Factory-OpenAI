/**
 * Brand Guardian Visual Agent — Gemini 3 Flash with tool calling
 * Evaluates product images against brand guidelines.
 * Same pattern as Imaginable's gemini-visual.ts.
 */

import { GoogleGenAI, Tool, Type } from "@google/genai";

export const VISUAL_MODEL_NAME = "gemini-3-flash-preview";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "project-ca52e7fa-d4e3-47fa-9df";
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";

let visualClient: GoogleGenAI | null = null;

export const getVisualClient = () => {
  if (!visualClient) {
    visualClient = new GoogleGenAI({
      vertexai: true,
      project: PROJECT_ID,
      location: LOCATION,
    });
  }
  return visualClient;
};

export type EvalBranch = "pass" | "fail";

export type BrandGuardianResult = {
  branch: EvalBranch | null;
  complianceScore: number | null;
  feedbackSentence: string | null;
  violations: string[];
};

export const BRAND_GUARDIAN_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "evaluate_brand_compliance",
        description:
          "Evaluate a product image against brand style guidelines and return compliance assessment.",
        parameters: {
          type: Type.OBJECT,
          required: ["branch", "compliance_score", "feedback_sentence", "violations"],
          properties: {
            branch: {
              type: Type.STRING,
              enum: ["pass", "fail"],
              description: "Whether the image passes brand guidelines: 'pass' or 'fail'.",
            },
            compliance_score: {
              type: Type.NUMBER,
              description: "Compliance score from 0 to 100.",
            },
            feedback_sentence: {
              type: Type.STRING,
              description: "A short summary of the brand compliance assessment.",
            },
            violations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "List of specific brand guideline violations found.",
            },
          },
        },
      },
    ],
  },
];

export const SYSTEM_INSTRUCTION = `You are the Brand Guardian Visual Agent for TrendSync Brand Factory.

You evaluate fashion product images against brand style guidelines.

You receive:
- A product image
- Brand style rules (colors, lighting, materials, camera settings, negative prompts)

Your job:
1. Analyse the image for brand compliance
2. Check color palette adherence
3. Check lighting quality and style match
4. Check composition and camera angle
5. Check for any negative prompt violations
6. Call evaluate_brand_compliance with your assessment

Rules:
- You MUST always call evaluate_brand_compliance
- Be thorough but fair — minor variations in color are acceptable
- Focus on commercial quality and brand consistency
- Score 90-100 = excellent, 75-89 = good, 60-74 = fair, below 60 = needs revision
`;

type EvaluateArgs = {
  branch?: unknown;
  compliance_score?: unknown;
  feedback_sentence?: unknown;
  violations?: unknown;
};

type FunctionCall = { name: string; args?: unknown };
type ResponseWithFunctionCalls = { functionCalls?: FunctionCall[] };

export async function runBrandGuardianVisual(params: {
  imageBase64Jpeg: string;
  brandStyleDescription: string;
}): Promise<BrandGuardianResult> {
  const { imageBase64Jpeg, brandStyleDescription } = params;

  if (!imageBase64Jpeg) {
    return { branch: null, complianceScore: null, feedbackSentence: null, violations: [] };
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
          "Evaluate this fashion product image against the following brand guidelines:",
          "",
          brandStyleDescription,
          "",
          "Call evaluate_brand_compliance with your assessment.",
        ].join("\n"),
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: BRAND_GUARDIAN_TOOLS,
      temperature: 0.2,
    },
  });

  const functionCalls = (response as unknown as ResponseWithFunctionCalls).functionCalls ?? [];

  for (const call of functionCalls) {
    if (call.name !== "evaluate_brand_compliance") continue;
    const args = (call.args ?? {}) as EvaluateArgs;

    const branch = String(args.branch ?? "").toLowerCase();
    const score = Number(args.compliance_score ?? 0);
    const feedback = String(args.feedback_sentence ?? "").trim();
    const violations = Array.isArray(args.violations)
      ? args.violations.map(String)
      : [];

    return {
      branch: branch === "pass" || branch === "fail" ? (branch as EvalBranch) : null,
      complianceScore: score,
      feedbackSentence: feedback || null,
      violations,
    };
  }

  return {
    branch: "fail",
    complianceScore: 50,
    feedbackSentence: "Could not fully evaluate — please review manually.",
    violations: ["Automated evaluation incomplete"],
  };
}
