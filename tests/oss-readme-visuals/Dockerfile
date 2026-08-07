FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN chmod +x tests/oss-readme-visuals/run.sh

CMD ["tests/oss-readme-visuals/run.sh"]
