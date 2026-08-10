FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN chmod +x tests/test162-node-list-virtualization/run.sh

ARG TEST162_SOURCE_COMMIT=unknown
ENV TEST162_SOURCE_COMMIT=$TEST162_SOURCE_COMMIT

CMD ["tests/test162-node-list-virtualization/run.sh"]
