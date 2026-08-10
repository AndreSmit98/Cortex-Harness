type PromptBearingConversation = {
  promptPrefix?: string | null;
};

/**
 * Adds the administrator-owned assistant identity ahead of any conversation-specific prompt.
 * The identity stays server-side and applies consistently across supported model endpoints.
 */
export function applyAssistantIdentity<T extends PromptBearingConversation>(
  conversation: T,
  systemPrompt?: string | null,
): T {
  const identityPrompt = systemPrompt?.trim();
  if (!identityPrompt) {
    return conversation;
  }

  const conversationPrompt = conversation.promptPrefix?.trim();
  if (
    conversationPrompt === identityPrompt ||
    conversationPrompt?.startsWith(`${identityPrompt}\n\n`) === true
  ) {
    return conversation;
  }

  return {
    ...conversation,
    promptPrefix: conversationPrompt
      ? `${identityPrompt}\n\n${conversationPrompt}`
      : identityPrompt,
  };
}
