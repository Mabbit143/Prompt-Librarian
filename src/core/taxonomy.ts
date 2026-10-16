import { z } from "zod";

// Categories are the 19 already in the user's Prompt Library (counts in docs/STATUS.md). The spec's subject labels
// are kept as optional topic tags, not categories.
export const RECORD_TYPES = ["Prompt", "Idea", "Template", "Research Note", "Workflow", "Reference", "Skill Definition", "Project Concept", "Prompt fragment", "Prompt bundle", "Mixed"] as const;
export const CATEGORIES = ["Writing & Editing", "E-commerce", "Business Strategy", "Audio & Video", "Teaching & Learning", "Relationships & Parenting", "Travel & Events", "Design & Visuals", "Prompt Engineering", "Home & Lifestyle", "Marketing & Sales", "Health & Wellbeing", "Creative Writing", "Finance & Money", "Social Media", "Productivity & Systems", "Research & Analysis", "Coding & Data", "Career & Freelancing"] as const;
export const SPEC_TOPIC_TAGS = ["Academic Writing", "Research & Evidence", "Anthropology", "Public Policy", "Education & UDL", "AI Development", "Prompt Engineering", "Automation", "Productivity", "Content Creation", "Deconstructing Academia", "Scholarships & Funding", "Reentry Programs", "App Development", "Personal Knowledge Management"] as const;
export const PROMPT_FAMILIES = ["Utility", "Verification", "Data Enrichment", "Orchestration", "General Prompt"] as const;
// The 35 Output Type values in the user's Prompt Library sheet (2026-10-12 export), most frequent first.
export const OUTPUT_TYPES = ["Draft", "Template", "Plan", "Design", "Analyze", "Research", "Audit", "Strategy Plan", "Idea", "Workflow", "Prompt Template", "Comparison", "Explanation", "Fragment", "Code", "Content Draft", "Visual Brief", "Edit", "Research Brief", "Checklist", "Idea Generator", "Script", "Organize", "Prompt collection", "Study Guide", "Decision Aid", "Question Set", "Rewrite", "Source collection", "Ideas", "Outline", "Summary", "Email Sequence", "Run workflow", "Rubric"] as const;

export const ClassificationSchema = z.object({
  record_type: z.enum(RECORD_TYPES),
  suggested_title: z.string().min(1).max(100),
  // Exactly one approved category: the closest fit. Secondary concepts go in tags/topic_tags.
  primary_category: z.enum(CATEGORIES),
  // Optional free-text refinement; null rather than invented.
  subcategory: z.string().trim().min(1).max(60).nullable(),
  // Set only when no approved category fits. Never filed automatically: it routes to a human via a new_category review.
  proposed_category: z.string().trim().min(1).max(60).nullable(),
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
