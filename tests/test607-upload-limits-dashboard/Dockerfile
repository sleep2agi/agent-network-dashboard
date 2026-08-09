FROM oven/bun:1.3.14

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN bun install --ignore-scripts

COPY . .
ARG SOURCE_COMMIT
ENV TEST607_DASHBOARD_SOURCE_COMMIT=$SOURCE_COMMIT
ENV NEXT_TELEMETRY_DISABLED=1
RUN chmod 0755 /workspace/tests/test607-upload-limits-dashboard/run.sh
ENTRYPOINT ["/workspace/tests/test607-upload-limits-dashboard/run.sh"]
