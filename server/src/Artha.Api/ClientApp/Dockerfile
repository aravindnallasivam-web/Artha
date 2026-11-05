# Artha web app: build the Angular SPA, then serve the static files with nginx.
# The app is serverless (data lives in the user's Google Drive); the only
# server-side piece is /oauth/token, which adds the OAuth client secret from
# the GOOGLE_CLIENT_SECRET environment variable (see nginx/oauth.js).
#
#   docker run -d -p 8090:80 -e GOOGLE_CLIENT_SECRET=... ghcr.io/aravindnallasivam-web/artha-web:latest

# The build output is plain HTML/JS/CSS, identical on every CPU, so build it
# once on the builder's native platform and only vary the nginx stage.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration production,docker

FROM nginx:1.27-alpine
# Lets the template use the container's own DNS servers for the Google call.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
RUN sed -i '1i load_module modules/ngx_http_js_module.so;\nenv GOOGLE_CLIENT_SECRET;' /etc/nginx/nginx.conf \
 && rm -f /etc/nginx/conf.d/default.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/oauth.js /etc/nginx/njs/oauth.js
COPY --from=build /app/dist/client/browser /usr/share/nginx/html
EXPOSE 80
