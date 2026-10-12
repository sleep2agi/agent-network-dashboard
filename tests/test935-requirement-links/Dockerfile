FROM mcr.microsoft.com/playwright:v1.59.1-noble@sha256:b0ab6f3cb99aa7803adbc14d9027ec1785fc6e433b97e134e0f8fe61683b6b53
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
CMD ["sh", "-c", "node app/lib/requirement-links.test.mjs && npx --no-install tsc --noEmit && npx --no-install playwright test tests/e2e-requirement-links.spec.ts --workers=1 --reporter=line"]
