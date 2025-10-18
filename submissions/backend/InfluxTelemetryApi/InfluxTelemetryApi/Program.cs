using Microsoft.AspNetCore.Mvc;
using InfluxDB.Client;
using System.Globalization;
using InfluxTelemetryApi.DTO;


var builder = WebApplication.CreateBuilder(args);

// Загрузка .env файла
DotNetEnv.Env.Load();

// Конфигурация InfluxDB
var influxUrl = Environment.GetEnvironmentVariable("INFLUX_URL") ?? "http://185.234.114.212:8086/";
var influxToken = Environment.GetEnvironmentVariable("INFLUX_TOKEN") ?? throw new Exception("INFLUX_TOKEN not set");
var influxOrg = Environment.GetEnvironmentVariable("INFLUX_ORG") ?? "Kontrol Techniki";
var influxBucket = Environment.GetEnvironmentVariable("INFLUX_BUCKET") ?? "t";
var influxMeasurement = Environment.GetEnvironmentVariable("INFLUX_MEASUREMENT") ?? "telemetry";

builder.Services.AddSingleton(new InfluxDBClient(influxUrl, influxToken));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();

// GET /api/imeis - Получить список доступных IMEI
app.MapGet("/api/imeis", async (InfluxDBClient client, ILogger<Program> logger) =>
{
    logger.LogInformation("Fetching IMEIs from InfluxDB");
    
    var query = $@"
        from(bucket: ""{influxBucket}"")
          |> range(start: -30d)
          |> filter(fn: (r) => r[""_measurement""] == ""{influxMeasurement}"")
          |> keep(columns: [""imei""])
          |> distinct(column: ""imei"")
          |> sort(columns: [""imei""])
    ";

    logger.LogInformation("Executing query: {Query}", query);

    try
    {
        var queryApi = client.GetQueryApi();
        var tables = await queryApi.QueryAsync(query, influxOrg);
        
        logger.LogInformation("Received {Count} tables from InfluxDB", tables.Count);
        
        var imeis = new List<string>();
        foreach (var table in tables)
        {
            logger.LogInformation("Table has {Count} records", table.Records.Count);
            foreach (var record in table.Records)
            {
                // Данные в колонке imei
                string? imei = null;
                
                if (record.Values.ContainsKey("imei"))
                {
                    imei = record.Values["imei"]?.ToString();
                }
                
                if (!string.IsNullOrEmpty(imei))
                {
                    logger.LogInformation("Found IMEI: {Imei}", imei);
                    imeis.Add(imei);
                }
            }
        }

        logger.LogInformation("Found {Count} IMEIs", imeis.Count);
        return Results.Ok(new { imeis });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error fetching IMEIs");
        return Results.Problem($"Error: {ex.Message}");
    }
})
.WithName("GetImeis")
.WithOpenApi();

// GET /api/fields?imei=... - Получить список полей для IMEI
app.MapGet("/api/fields", async (InfluxDBClient client, [FromQuery] string imei, ILogger<Program> logger) =>
{
    if (string.IsNullOrEmpty(imei))
    {
        return Results.BadRequest(new { error = "IMEI parameter is required" });
    }

    logger.LogInformation("Fetching fields for IMEI: {Imei}", imei);

    var query = $@"
        from(bucket: ""{influxBucket}"")
          |> range(start: -30d)
          |> filter(fn: (r) => r[""_measurement""] == ""{influxMeasurement}"")
          |> filter(fn: (r) => r[""imei""] == ""{imei}"")
          |> group(columns: [""_field""])
          |> distinct(column: ""_field"")
          |> group()
    ";

    logger.LogInformation("Executing query: {Query}", query);

    try
    {
        var queryApi = client.GetQueryApi();
        var tables = await queryApi.QueryAsync(query, influxOrg);
        
        logger.LogInformation("Received {Count} tables from InfluxDB", tables.Count);
        
        var fields = new List<string>();
        foreach (var table in tables)
        {
            foreach (var record in table.Records)
            {
                string? field = null;
                
                if (record.Values.ContainsKey("_field"))
                {
                    field = record.Values["_field"]?.ToString();
                }
                else if (record.Values.ContainsKey("_value"))
                {
                    field = record.Values["_value"]?.ToString();
                }
                
                if (!string.IsNullOrEmpty(field))
                {
                    fields.Add(field);
                }
            }
        }

        logger.LogInformation("Found {Count} fields for IMEI {Imei}", fields.Count, imei);
        return Results.Ok(new { fields });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error fetching fields for IMEI: {Imei}", imei);
        return Results.Problem($"Error: {ex.Message}");
    }
})
.WithName("GetFields")
.WithOpenApi();

// GET /api/telemetry?imei=...&start=...&end=... - Получить данные телеметрии
app.MapGet("/api/telemetry", async (
    InfluxDBClient client, 
    [FromQuery] string imei,
    [FromQuery] string start,
    [FromQuery] string end) =>
{
    if (string.IsNullOrEmpty(imei) || string.IsNullOrEmpty(start) || string.IsNullOrEmpty(end))
    {
        return Results.BadRequest(new { error = "Parameters imei, start, and end are required" });
    }

    var query = $@"
        imei = ""{imei}""
        start = time(v: ""{start}"")
        stop = time(v: ""{end}"")

        from(bucket: ""{influxBucket}"")
          |> range(start: start, stop: stop)
          |> filter(fn: (r) => r[""_measurement""] == ""{influxMeasurement}"" and r[""imei""] == imei)
          |> filter(fn: (r) => 
              r[""_field""] == ""speed"" or 
              r[""_field""] == ""fls485_level_2"" or 
              r[""_field""] == ""latitude"" or 
              r[""_field""] == ""longitude"" or 
              r[""_field""] == ""main_power_voltage"" or 
              r[""_field""] == ""event_time"")
          |> pivot(rowKey: [""_time""], columnKey: [""_field""], valueColumn: ""_value"")
          |> sort(columns: [""_time""])
    ";

    var queryApi = client.GetQueryApi();
    var tables = await queryApi.QueryAsync(query, influxOrg);
    
    var speedData = new List<DTO.DataPoint>();
    var fls485Data = new List<DTO.DataPoint>();
    var voltageData = new List<DTO.DataPoint>();
    var trackData = new List<DTO.TrackPoint>();

    foreach (var table in tables)
    {
        foreach (var record in table.Records)
        {
            var time = record.GetTime()?.ToDateTimeUtc().ToString("yyyy-MM-ddTHH:mm:ssZ");
            
            // Speed
            if (record.Values.ContainsKey("speed"))
            {
                var speedValue = Convert.ToInt32(record.Values["speed"]);
                speedData.Add(new DTO.DataPoint { Time = time, Value = speedValue });
            }

            // FLS485 Level 2
            if (record.Values.ContainsKey("fls485_level_2"))
            {
                var flsValue = Convert.ToInt32(record.Values["fls485_level_2"]);
                fls485Data.Add(new DTO.DataPoint { Time = time, Value = flsValue });
            }

            // Main Power Voltage
            if (record.Values.ContainsKey("main_power_voltage"))
            {
                var voltageRaw = Convert.ToDouble(record.Values["main_power_voltage"]);
                var voltageInVolts = Math.Round(voltageRaw / 1000.0, 2);
                voltageData.Add(new DTO.DataPoint { Time = time, Value = voltageInVolts });
            }

            // Track
            if (record.Values.ContainsKey("latitude") && record.Values.ContainsKey("longitude"))
            {
                var lat = Convert.ToDouble(record.Values["latitude"]);
                var lon = Convert.ToDouble(record.Values["longitude"]);
                
                long eventTime;
                if (record.Values.ContainsKey("event_time"))
                {
                    var eventTimeValue = record.Values["event_time"];
                    if (eventTimeValue is string str)
                    {
                        eventTime = long.Parse(str);
                    }
                    else
                    {
                        eventTime = Convert.ToInt64(eventTimeValue);
                    }
                }
                else
                {
                    eventTime = record.GetTime()?.ToDateTimeUtc().Ticks ?? 0;
                    eventTime = (eventTime - 621355968000000000) / 10000000;
                }

                trackData.Add(new DTO.TrackPoint 
                { 
                    Time = time, 
                    Lat = lat, 
                    Lon = lon,
                    EventTime = eventTime
                });
            }
        }
    }

    var response = new
    {
        series = new
        {
            speed = speedData,
            fls485_level_2 = fls485Data,
            main_power_voltage = voltageData
        },
        track = trackData
    };

    return Results.Ok(response);
})
.WithName("GetTelemetry")
.WithOpenApi();

app.Run();
