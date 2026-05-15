# syntax=docker/dockerfile:1.7

# ---------- build (.NET 10 + Node 22) ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Install Node 22 via NodeSource (the .NET SDK image is Debian-based).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# 1. Restore .NET (cache-friendly layer — only invalidated when .csproj changes).
COPY Artha.slnx Directory.Build.props Directory.Packages.props global.json ./
COPY src/Artha.Api/Artha.Api.csproj                       src/Artha.Api/
COPY src/Artha.Core/Artha.Core.csproj                     src/Artha.Core/
COPY src/Artha.Auth/Artha.Auth.csproj                     src/Artha.Auth/
COPY src/Artha.Drive/Artha.Drive.csproj                   src/Artha.Drive/
COPY src/Artha.Infrastructure/Artha.Infrastructure.csproj src/Artha.Infrastructure/
RUN dotnet restore src/Artha.Api/Artha.Api.csproj

# 2. Restore npm packages separately so SPA dependency churn doesn't
#    bust the .NET layer cache.
COPY src/Artha.Api/ClientApp/package.json      src/Artha.Api/ClientApp/
COPY src/Artha.Api/ClientApp/package-lock.json src/Artha.Api/ClientApp/
RUN cd src/Artha.Api/ClientApp && npm ci

# 3. Copy the rest of the source and publish. The PublishSpa MSBuild target
#    in Artha.Api.csproj runs `npm run build` and copies the Angular bundle
#    into wwwroot during this step.
COPY src/ ./src/
RUN dotnet publish src/Artha.Api/Artha.Api.csproj \
        --configuration Release \
        --no-restore \
        --output /app/publish \
        /p:UseAppHost=false

# ---------- runtime ----------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Run as the non-root 'app' user that ships in the base image.
USER app

COPY --from=build --chown=app:app /app/publish ./

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://+:8080 \
    DOTNET_RUNNING_IN_CONTAINER=true

EXPOSE 8080

ENTRYPOINT ["dotnet", "Artha.Api.dll"]
