/**
 * Common grant application questions. When a FundingApplication is created
 * for an opportunity that has no per-opportunity FundingQuestion rows, these
 * are used as fallback prompts so the agent always has questions to draft
 * against.
 */

export interface QuestionTemplate {
  label: string;
  helpText: string;
  /** Context data keys from the tenant profile that help answer this. */
  dataKeys: string[];
}

export const COMMON_QUESTIONS: QuestionTemplate[] = [
  {
    label: "Describe your organisation and its purpose",
    helpText:
      "Cover the charity's objects as stated in its governing document, how long it has been operating, and the community it serves.",
    dataKeys: ["charitySettings", "orgProfile"],
  },
  {
    label: "How many active members do you have?",
    helpText:
      "Total active memberships, plus any trend information (growth/decline over recent years).",
    dataKeys: ["members"],
  },
  {
    label: "What is the project you need funding for?",
    helpText:
      "Describe the specific project or improvement: what will change, who benefits, and why it matters now.",
    dataKeys: [],
  },
  {
    label: "Provide a breakdown of how the funds will be used",
    helpText:
      "Itemised budget showing how the requested amount will be spent. Link to any quotes obtained.",
    dataKeys: ["financials"],
  },
  {
    label: "How will you measure success?",
    helpText:
      "Quantifiable outcomes or milestones you will track to demonstrate the grant was well used.",
    dataKeys: [],
  },
  {
    label: "What other funding sources have you applied to or received?",
    helpText:
      "List other grants applied for, match-funding secured, and own reserves allocated to this project.",
    dataKeys: ["financials", "fundingHistory"],
  },
  {
    label: "Describe the governance and management of your organisation",
    helpText:
      "How trustees are appointed, decision-making structures, safeguarding policy, and any relevant qualifications.",
    dataKeys: ["charitySettings", "trustees"],
  },
  {
    label: "How does your organisation benefit the wider community?",
    helpText:
      "Public benefit statement — who you serve beyond your membership, outreach programmes, partnerships.",
    dataKeys: ["events", "bookings", "members", "charitySettings"],
  },
];
