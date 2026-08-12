import { resolveOnDemandMCP, shouldActivateSelectedMCP } from '../mcpActivation';

describe('on-demand MCP activation', () => {
  const servers = ['rsaweb-mcp', 'internal_tools'];

  test.each([
    ['@mcp find the customer record', true],
    ['/mcp find the customer record', true],
    ['@rsaweb-mcp find the customer record', true],
    ['@internal-tools find the customer record', true],
    ['Tell me a joke', false],
    ['Explain what MCP means', false],
    ['Use @mcp-tools later', false],
  ])('activates %s: %s', (message, expected) => {
    expect(shouldActivateSelectedMCP(message, servers)).toBe(expected);
  });

  it('removes MCP servers while preserving other ephemeral tools for ordinary messages', () => {
    expect(
      resolveOnDemandMCP({
        message: 'Draft a short status update',
        ephemeralAgent: { mcp: servers, web_search: true },
      }),
    ).toEqual({ web_search: true });
  });

  it('does not send an empty ephemeral agent after removing MCP servers', () => {
    expect(
      resolveOnDemandMCP({
        message: 'Draft a short status update',
        ephemeralAgent: { mcp: servers },
      }),
    ).toBeNull();
  });

  it('keeps selected MCP servers when an explicit directive is present', () => {
    const ephemeralAgent = { mcp: servers, web_search: true };
    expect(
      resolveOnDemandMCP({ message: '@rsaweb-mcp find the customer record', ephemeralAgent }),
    ).toBe(ephemeralAgent);
  });
});
