# syntax=docker/dockerfile:1.7

# ---------- build ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first (cache-friendly layer)
COPY Artha.slnx Directory.Build.props Directory.Packages.props global.json ./
COPY src/Artha.Api/Artha.Api.csproj         src/Artha.Api/
COPY src/Artha.Core/Artha.Core.csproj       src/Artha.Core/
COPY src/Artha.Auth/Artha.Auth.csproj       src/Artha.Auth/
COPY src/Artha.Drive/Artha.Drive.csproj     src/Artha.Drive/
COPY src/Artha.Infrastructure/Artha.Infrastructure.csproj src/Artha.Infrastructure/
RUN dotnet restore src/Artha.Api/Artha.Api.csproj

# Build + publish only the API project
COPY src/ ./src/
RUN dotnet publish src/Artha.Api/Artha.Api.csproj \
        --configuration Release \
        --no-restore \
        --output /app/publish \
        /p:UseAppHost=false

# ---------- runtime ----------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Run as a non-root user (uid 1000 ships in the base image).
USER app

COPY --from=build --chown=app:app /app/publish ./

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://+:8080 \
    DOTNET_RUNNING_IN_CONTAINER=true

EXPOSE 8080

ENTRYPOINT ["dotnet", "Artha.Api.dll"]
