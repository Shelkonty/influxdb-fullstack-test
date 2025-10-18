FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY ["InfluxTelemetryApi/InfluxTelemetryApi.csproj", "InfluxTelemetryApi/"]
RUN dotnet restore "InfluxTelemetryApi/InfluxTelemetryApi.csproj"
COPY . .
WORKDIR "/src/InfluxTelemetryApi"
RUN dotnet build "InfluxTelemetryApi.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "InfluxTelemetryApi.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "InfluxTelemetryApi.dll"]
