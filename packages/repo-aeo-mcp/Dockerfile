# syntax=docker/dockerfile:1
#
# A tiny, dependency-free image for the repo-aeo-mcp stdio server.
#
# Build from the repository root:
#   docker build -t repo-aeo-mcp packages/repo-aeo-mcp
#
# Run it (stdio stays attached, so -i is required):
#   docker run -i repo-aeo-mcp serve
#
# Audit a repository that is not part of this build context:
#   docker run -i -v "$PWD:/repo" -w /repo repo-aeo-mcp serve

FROM node:22-alpine

# `gh` is optional: without it the GitHub tool reports that it is unavailable
# instead of failing. Mount a token file to enable it.
RUN apk add --no-cache github-cli

WORKDIR /app

# Dependencies first so a code change does not invalidate the layer.
COPY packages/repo-aeo-mcp/package.json ./packages/repo-aeo-mcp/package.json
COPY packages/rdk-cli/package.json ./packages/rdk-cli/package.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY packages/repo-aeo-mcp/ ./packages/repo-aeo-mcp/
COPY packages/rdk-cli/ ./packages/rdk-cli/

# The server speaks on stdio; nothing is exposed over the network.
ENV NODE_ENV=production
ENTRYPOINT ["node", "packages/repo-aeo-mcp/bin/repo-aeo-mcp.js"]
CMD ["serve"]

LABEL org.opencontainers.image.title="repo-aeo-mcp" \
      org.opencontainers.image.description="MCP server for continuous repository discoverability monitoring" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/WhiteBite/signal-forge"
