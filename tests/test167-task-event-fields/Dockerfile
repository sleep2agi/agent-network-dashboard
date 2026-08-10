FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

ARG TEST167_SOURCE_COMMIT=unknown
ENV TEST167_SOURCE_COMMIT=$TEST167_SOURCE_COMMIT

COPY . .
RUN chmod +x tests/test167-task-event-fields/run.sh

CMD ["tests/test167-task-event-fields/run.sh"]
