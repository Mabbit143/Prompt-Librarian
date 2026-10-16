import { z } from "zod";

// Provisional: seeded from the spec. Must be reconciled with the Notion "Category" options
// and the Sheets "Category Guide" tab before auto-filing is enabled (see docs/INVENTORY.md).
export const RECORD_TYPES = ["Prompt", "Idea", "Template", "Research Note", "Workflow", "Reference", "Skill Definition", "Project Concept"] as const;
export const CATEGORIES = ["Academic Writing", "Research & Evidence", "Anthropology", "Public Policy", "Education & UDL", "AI Development", "Prompt Engineering", "Automation", "Productivity", "Content Creation", "Deconstructing Academia", "Scholarships & Funding", "Reentry Programs", "App Development", "Personal Knowledge Management"] as const;
export const PROMPT_FAMILIES = ["Utility", "Verification", "Data Enrichment", "Orchestration", "General Prompt"] as const;
export const OUTPUT_TYPES = ["Essay", "Reading Response", "Research Summary", "Lesson Plan", "Checklist", "Social Post", "Carousel", "Hook Template", "CTA Template", "Email", "Database", "App Specification", "Code", "Research Question"] as const;

export const ClassificationSchema = z.object({
  record_type: z.enum(RECORD_TYPES),
  suggested_title: z.string().min(1).max(100),
  primary_category: z.enum(CATEGORIES),
  secondary_category: z.enum(CATEGORIES).nullable(),
  prompt_family: z.enum(PROMPT_FAMILIES).nullable(),
  output_type: z.enum(OUTPUT_TYPES).nullable(),
  tags: z.array(z.string().min(1).max(40)).max(10),
  topic_tags: z.array(z.string().min(1).max(40)).max(10),
  confidence: z.number().min(0).max(1),
  confidence_reason: z.string().max(300),
  potential_duplicate: z.boolean(),
  review_required: z.boolean(),
  classifier_version: z.string().min(1),
}).strict();

export type Classification = z.infer<typeof ClassificationSchema>;
