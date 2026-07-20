export type SessionContext = {
  bankId: string;
  sessionId: string;
  startedAt: Date;
};

export type ToolContext = {
  sessionId: string;
  toolName: string;
  args?: unknown;
};

export type PromptContext = {
  sessionId: string;
  text: string;
};

export type ResponseContext = {
  sessionId: string;
  text: string;
};

export type ToolResult<T = unknown> = {
  summary?: string;
  data?: T;
  success: boolean;
};

export interface SessionHooks {
  onSessionStart?(context: SessionContext): Promise<void> | void;
  onSessionEnd?(context: SessionContext): Promise<void> | void;
  onPreToolUse?(context: ToolContext): Promise<void> | void;
  onPostToolUse?(context: ToolContext, result: ToolResult): Promise<void> | void;
  onUserPrompt?(context: PromptContext): Promise<void> | void;
  onAgentResponse?(context: ResponseContext): Promise<void> | void;
}
