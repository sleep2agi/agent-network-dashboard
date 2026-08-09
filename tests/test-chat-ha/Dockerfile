FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG SOURCE_COMMIT
ENV TEST459_SOURCE_COMMIT=$SOURCE_COMMIT
RUN chmod +x tests/test-chat-ha/run.sh
CMD ["tests/test-chat-ha/run.sh"]
