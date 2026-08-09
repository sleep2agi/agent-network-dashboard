FROM node:22-bookworm-slim
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG SOURCE_COMMIT
ENV DASHBOARD_SCHEDULER_SOURCE_COMMIT=$SOURCE_COMMIT
RUN chmod 0755 tests/test-scheduled-tasks/run.sh
ENTRYPOINT ["tests/test-scheduled-tasks/run.sh"]
