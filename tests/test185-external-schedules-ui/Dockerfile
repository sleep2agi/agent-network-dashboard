FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

ARG TEST185_DASH_SOURCE_COMMIT=unknown
ENV TEST185_DASH_SOURCE_COMMIT=${TEST185_DASH_SOURCE_COMMIT}
COPY . .
RUN chmod +x tests/test185-external-schedules-ui/run.sh

CMD ["tests/test185-external-schedules-ui/run.sh"]
