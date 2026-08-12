import type { TEphemeralAgent } from 'librechat-data-provider';

const globalMCPDirective = /(?:^|\s)(?:@mcp|\/mcp)(?=\s|$)/i;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasServerDirective = (message: string, serverName: string): boolean => {
  const normalizedName = serverName.replace(/[_\s]+/g, '-');
  const pattern = new RegExp(`(?:^|\\s)@${escapeRegExp(normalizedName)}(?=\\s|$)`, 'i');
  return pattern.test(message);
};

/**
 * Selected MCP servers are available on demand. A turn opts in only when the
 * user starts a directive with `@mcp`, `/mcp`, or a selected `@server-name`.
 */
export const shouldActivateSelectedMCP = (message: string, serverNames: string[]): boolean =>
  globalMCPDirective.test(message) ||
  serverNames.some((serverName) => hasServerDirective(message, serverName));

export const resolveOnDemandMCP = ({
  message,
  ephemeralAgent,
}: {
  message: string;
  ephemeralAgent: TEphemeralAgent | null | undefined;
}): TEphemeralAgent | null | undefined => {
  const selectedServers = ephemeralAgent?.mcp;
  if (
    !ephemeralAgent ||
    !selectedServers?.length ||
    shouldActivateSelectedMCP(message, selectedServers)
  ) {
    return ephemeralAgent;
  }

  const { mcp: _mcp, ...agentWithoutMCP } = ephemeralAgent;
  return Object.keys(agentWithoutMCP).length > 0 ? agentWithoutMCP : null;
};
