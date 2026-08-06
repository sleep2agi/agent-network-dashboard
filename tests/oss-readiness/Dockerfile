FROM node:22-bookworm-slim

WORKDIR /src
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN chmod +x tests/oss-readiness/run.sh

CMD ["tests/oss-readiness/run.sh"]
