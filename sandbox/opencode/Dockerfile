FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    curl git jq wget python3 build-essential nodejs npm \
    procps sysstat \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH="/root/.opencode/bin:${PATH}"

RUN mkdir -p /state /workspace

COPY BOOTSTRAP.md /state/BOOTSTRAP.md
COPY OPERATING.md /state/OPERATING.md
COPY SHOWCASE.md /state/SHOWCASE.md
COPY opencode/opencode.json /workspace/opencode.json
COPY opencode/agent-loop.sh /usr/local/bin/agent-loop.sh
RUN chmod +x /usr/local/bin/agent-loop.sh

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/agent-loop.sh"]
