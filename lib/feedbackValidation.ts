const VALID_FEEDBACK_TYPES = new Set([
  "Feature request",
  "Something is confusing",
  "Report a problem",
  "Something I like",
  "Other",
]);

export function validateFeedbackSubmission(input: {
  feedbackType: string;
  title: string;
  description: string;
}) {
  const title = input.title.trim();
  const description = input.description.trim();

  if (!VALID_FEEDBACK_TYPES.has(input.feedbackType)) {
    return "Choose a feedback type.";
  }
  if (!title || !description) {
    return "Add a short title and description so our team can understand the feedback.";
  }
  if (title.length > 160) return "Keep the title to 160 characters or fewer.";
  if (description.length > 5000) {
    return "Keep the description to 5,000 characters or fewer.";
  }

  return null;
}
