FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
ARG SOURCE_COMMIT
ENV TEST690_SOURCE_COMMIT=$SOURCE_COMMIT
COPY . .
RUN chmod 0755 tests/test690-owner-schedule-dashboard/run.sh
ENTRYPOINT ["tests/test690-owner-schedule-dashboard/run.sh"]
