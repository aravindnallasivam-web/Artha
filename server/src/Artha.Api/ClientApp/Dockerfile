# Artha web app: build the Angular SPA, then serve the static files with nginx.
# The app is serverless (data lives in the user's Google Drive), so this image
# is the whole deployment.

# The build output is plain HTML/JS/CSS, identical on every CPU, so build it
# once on the builder's native platform and only vary the nginx stage.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration production

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/client/browser /usr/share/nginx/html
EXPOSE 80
