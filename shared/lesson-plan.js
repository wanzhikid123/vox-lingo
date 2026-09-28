import { z } from "zod";
import { practiceToolSchema } from "./contracts.js";
import { instructionLanguages } from "./languages.js";

export const planStepSchema = practiceToolSchema
  .omit({ expectedRevision: true })
  .extend({
    id: z.string().regex(/^[\w-]{1,80}$/),
    stage: z.enum(["review", "new", "practice"]),
    seconds: z.number().int().min(15).max(120),
  });
export const lessonPlanSchema = z.object({
  goal: z.string().trim().min(1).max(500),
  steps: z.array(planStepSchema).min(1).max(36),
});
export const planRequestSchema = z.object({
  instructionLanguage: z.enum(instructionLanguages).optional(),
  expectedTopicRevision: z.number().int().min(1),
  expectedRevision: z.number().int().min(0),
});
export const savePlanSchema = planRequestSchema.extend({
  plan: lessonPlanSchema,
});
