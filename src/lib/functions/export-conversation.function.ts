import { ChatConversation } from "@/types/completion";

/**
 * Renders a conversation as a readable meeting-debrief markdown document.
 * Messages are stored newest-first; the export is chronological.
 */
export const conversationToMarkdown = (
  conversation: ChatConversation
): string => {
  const title = conversation.title || "Conversation";
  const chronological = [...conversation.messages].reverse();

  let markdown = `# ${title}\n\n`;
  if (conversation.updatedAt) {
    markdown += `**Date:** ${new Date(
      conversation.updatedAt
    ).toLocaleString()}\n`;
  }
  markdown += `**Turns:** ${chronological.length}\n\n---\n\n`;

  for (const message of chronological) {
    const time = message.timestamp
      ? new Date(message.timestamp).toLocaleTimeString()
      : "";
    if (message.role === "user") {
      markdown += `## Q${time ? ` (${time})` : ""}\n\n${message.content}\n\n`;
    } else if (message.role === "assistant") {
      markdown += `### Answer\n\n${message.content}\n\n`;
    }
  }

  return markdown;
};

/** Triggers a browser download of the conversation as a .md file. */
export const downloadConversationMarkdown = (
  conversation: ChatConversation
): void => {
  const markdown = conversationToMarkdown(conversation);
  const sanitized = (conversation.title || "session")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()
    .substring(0, 32);
  const date = new Date().toISOString().slice(0, 10);

  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitized}_${date}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
