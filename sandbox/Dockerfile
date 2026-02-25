# sandbox/Dockerfile
FROM ubuntu:24.04

# System packages
RUN apt-get update && apt-get install -y \
    curl git jq wget python3 build-essential nodejs npm \
    procps sysstat \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode
RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH="/root/.opencode/bin:${PATH}"

# Create directories
RUN mkdir -p /state /workspace

# Copy config files
COPY opencode.json /workspace/opencode.json
COPY BOOTSTRAP.md /state/BOOTSTRAP.md
COPY agent-loop.sh /usr/local/bin/agent-loop.sh
RUN chmod +x /usr/local/bin/agent-loop.sh

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/agent-loop.sh"]
