export const QUEUE_NAME = "slack-support-agent";

export interface IssueLink {
  tracker: "linear" | "jira";
  key: string;
  url: string;
}

export interface SupportRequest {
  requestId: string;
  userId?: string;
  subject: string;
  body: string;
  slackChannel?: string;
  slackThreadTs?: string;
  issue?: IssueLink;
}

export interface JobData {
  request: SupportRequest;
}
