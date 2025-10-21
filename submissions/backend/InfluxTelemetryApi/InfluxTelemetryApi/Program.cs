using Microsoft.AspNetCore.Mvc;
using InfluxDB.Client;
using System.Globalization;
using InfluxTelemetryApi.DTO;


var builder = WebApplication.CreateBuilder(args);

DotNetEnv.Env.Load();

// fallback InfluxDB
var influxUrl = Environment.GetEnvironmentVariable("INFLUX_URL") ?? "http://185.234.114.212:8086/";
var influxToken = Environment.GetEnvironmentVariable("INFLUX_TOKEN") ?? throw new Exception("INFLUX_TOKEN not set");
var influxOrg = Environment.GetEnvironmentVariable("INFLUX_ORG") ?? "Kontrol Techniki";
var influxBucket = Environment.GetEnvironmentVariable("INFLUX_BUCKET") ?? "t";
var influxMeasurement = Environment.GetEnvironmentVariable("INFLUX_MEASUREMENT") ?? "telemetry";

// Конфигурация с увеличенным таймаутом
var influxOptions = new InfluxDBClientOptions(influxUrl)
{
    Token = influxToken,
    Timeout = TimeSpan.FromSeconds(120)
};
builder.Services.AddSingleton(new InfluxDBClient(influxOptions));
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

// GET /api/imeis - список  IMEI
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

// GET /api/fields?imei=... - список полей для IMEI
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
          |> sort()
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

app.MapGet("/api/telemetry", async (
    InfluxDBClient client, 
    [FromQuery] string imei,
    [FromQuery] long startTimestamp,
    [FromQuery] long endTimestamp,
    ILogger<Program> logger) =>
{
    if (string.IsNullOrEmpty(imei) || startTimestamp <= 0 || endTimestamp <= 0)
    {
        return Results.BadRequest(new { error = "Parameters imei, startTimestamp, and endTimestamp are required" });
    }

    if (startTimestamp >= endTimestamp)
    {
        return Results.BadRequest(new { error = "startTimestamp must be less than endTimestamp" });
    }

    var startDateTime = DateTimeOffset.FromUnixTimeSeconds(startTimestamp).UtcDateTime;
    var endDateTime = DateTimeOffset.FromUnixTimeSeconds(endTimestamp).UtcDateTime;
    
    var startRFC3339 = startDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ");
    var endRFC3339 = endDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ");

    // Вычисляем диапазон в днях
    var rangeDays = (endTimestamp - startTimestamp) / (60.0 * 60.0 * 24.0);
    
    // Определяем интервал агрегации
    string aggregationWindow;
    if (rangeDays <= 1)
    {
        aggregationWindow = "1m";  // До 1 дня - каждую минуту
    }
    else if (rangeDays <= 7)
    {
        aggregationWindow = "5m";  // До недели - каждые 5 минут
    }
    else if (rangeDays <= 30)
    {
        aggregationWindow = "15m"; // До месяца - каждые 15 минут
    }
    else if (rangeDays <= 90)
    {
        aggregationWindow = "1h";  // До 3 месяцев - каждый час
    }
    else
    {
        aggregationWindow = "4h";  // Больше 3 месяцев - каждые 4 часа
    }

    logger.LogInformation(
        "Fetching telemetry for IMEI: {Imei}, Start: {Start}, End: {End}, Range: {Range} days, Aggregation: {Agg}", 
        imei, startRFC3339, endRFC3339, Math.Round(rangeDays, 2), aggregationWindow
    );
    
    var query = $@"
        import ""strings""
        
        from(bucket: ""{influxBucket}"")
          |> range(start: {startRFC3339}, stop: {endRFC3339})
          |> filter(fn: (r) => r[""_measurement""] == ""{influxMeasurement}"")
          |> filter(fn: (r) => r[""imei""] == ""{imei}"")
          |> filter(fn: (r) => 
              r[""_field""] == ""speed"" or 
              r[""_field""] == ""main_power_voltage"" or 
              r[""_field""] == ""latitude"" or 
              r[""_field""] == ""longitude"" or 
              r[""_field""] == ""event_time"" or
              strings.hasPrefix(v: r[""_field""], prefix: ""fls485_level_"")
          )
          |> aggregateWindow(every: {aggregationWindow}, fn: mean, createEmpty: false)
          |> pivot(rowKey: [""_time""], columnKey: [""_field""], valueColumn: ""_value"")
          |> sort(columns: [""_time""])
    ";

    logger.LogInformation("Executing optimized query with aggregation: {Aggregation}", aggregationWindow);

    try
    {
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        
        var queryApi = client.GetQueryApi();
        var tables = await queryApi.QueryAsync(query, influxOrg);
        
        stopwatch.Stop();
        logger.LogInformation(
            "Query completed in {ElapsedMs}ms. Received {Count} tables from InfluxDB", 
            stopwatch.ElapsedMilliseconds, 
            tables.Count
        );
        
        var speedData = new List<DTO.DataPoint>();
        var voltageData = new List<DTO.DataPoint>();
        var trackData = new List<DTO.TrackPoint>();
        
        var fuelSensorsRaw = new Dictionary<string, List<DTO.DataPoint>>();
        var fuelSumData = new List<DTO.DataPoint>();

        foreach (var table in tables)
        {
            foreach (var record in table.Records)
            {
                var influxTime = record.GetTime();
                if (!influxTime.HasValue) continue;

                var timestamp = influxTime.Value.ToDateTimeUtc();
                var unixTimestamp = new DateTimeOffset(timestamp).ToUnixTimeSeconds();
                
                // Speed
                if (record.Values.ContainsKey("speed"))
                {
                    var speedValue = Convert.ToDouble(record.Values["speed"]);
                    speedData.Add(new DTO.DataPoint 
                    { 
                        Time = unixTimestamp.ToString(), 
                        Value = Math.Round(speedValue, 2)
                    });
                }

                // Voltage
                if (record.Values.ContainsKey("main_power_voltage"))
                {
                    var voltageRaw = Convert.ToDouble(record.Values["main_power_voltage"]);
                    var voltageInVolts = Math.Round(voltageRaw / 1000.0, 2);
                    voltageData.Add(new DTO.DataPoint 
                    { 
                        Time = unixTimestamp.ToString(), 
                        Value = voltageInVolts 
                    });
                }

                // Датчики топлива
                double totalFuel = 0;
                bool hasFuelData = false;
                
                foreach (var key in record.Values.Keys)
                {
                    if (key.StartsWith("fls485_level_"))
                    {
                        if (!fuelSensorsRaw.ContainsKey(key))
                        {
                            fuelSensorsRaw[key] = new List<DTO.DataPoint>();
                        }
                        
                        var fuelValue = Convert.ToDouble(record.Values[key]);
                        fuelSensorsRaw[key].Add(new DTO.DataPoint
                        {
                            Time = unixTimestamp.ToString(),
                            Value = Math.Round(fuelValue, 2)
                        });
                        
                        totalFuel += fuelValue;
                        hasFuelData = true;
                    }
                }
                
                // Сумма топлива
                if (hasFuelData)
                {
                    fuelSumData.Add(new DTO.DataPoint
                    {
                        Time = unixTimestamp.ToString(),
                        Value = Math.Round(totalFuel, 2)
                    });
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
                        eventTime = eventTimeValue is string str ? long.Parse(str) : Convert.ToInt64(eventTimeValue);
                    }
                    else
                    {
                        eventTime = unixTimestamp;
                    }

                    trackData.Add(new DTO.TrackPoint 
                    { 
                        Time = unixTimestamp.ToString(), 
                        Lat = lat, 
                        Lon = lon,
                        EventTime = eventTime
                    });
                }
            }
        }

        logger.LogInformation(
            "Query completed: Speed={Speed}, Voltage={Voltage}, Track={Track}, FuelSensors={Fuel}, TotalFuel={Total}",
            speedData.Count, voltageData.Count, trackData.Count, fuelSensorsRaw.Count, fuelSumData.Count
        );

        var response = new
        {
            series = new Dictionary<string, object>
            {
                { "speed", speedData },
                { "main_power_voltage", voltageData },
                { "fuel_total", fuelSumData }
            },
            fuelSensors = fuelSensorsRaw,
            track = trackData,
            metadata = new
            {
                startTimestamp = startTimestamp,
                endTimestamp = endTimestamp,
                totalRecords = trackData.Count,
                availableFuelSensors = fuelSensorsRaw.Keys.OrderBy(k => k).ToList(),
                aggregationWindow = aggregationWindow,
                rangeDays = Math.Round(rangeDays, 2)
            }
        };

        return Results.Ok(response);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error fetching telemetry for IMEI: {Imei}", imei);
        return Results.Problem($"Error: {ex.Message}\nStack: {ex.StackTrace}");
    }
})
.WithName("GetTelemetry")
.WithOpenApi();

// GET /api/debug/time?imei=...&date=... - Диагностика времени
app.MapGet("/api/debug/time", async (
    InfluxDBClient client,
    [FromQuery] string imei,
    [FromQuery] string date, // Формат: 2024-11-20
    ILogger<Program> logger) =>
{
    if (string.IsNullOrEmpty(imei) || string.IsNullOrEmpty(date))
    {
        return Results.BadRequest(new { error = "Parameters imei and date are required" });
    }

    logger.LogInformation("Debug time query for IMEI: {Imei}, Date: {Date}", imei, date);

    // Запрос на весь день
    var query = $@"
        from(bucket: ""{influxBucket}"")
          |> range(start: {date}T00:00:00Z, stop: {date}T23:59:59Z)
          |> filter(fn: (r) => r[""_measurement""] == ""{influxMeasurement}"")
          |> filter(fn: (r) => r[""imei""] == ""{imei}"")
          |> limit(n: 10)
    ";

    logger.LogInformation("Executing debug query: {Query}", query);

    try
    {
        var queryApi = client.GetQueryApi();
        var tables = await queryApi.QueryAsync(query, influxOrg);

        var results = new List<object>();
        foreach (var table in tables)
        {
            foreach (var record in table.Records)
            {
                var time = record.GetTime();
                if (time.HasValue)
                {
                    var utc = time.Value.ToDateTimeUtc();
                    var unix = new DateTimeOffset(utc).ToUnixTimeSeconds();
                    
                    results.Add(new
                    {
                        influx_time = time.Value.ToString(),
                        utc_datetime = utc.ToString("yyyy-MM-dd HH:mm:ss"),
                        unix_timestamp = unix,
                        field = record.GetField(),
                        value = record.GetValue()
                    });
                }
            }
        }

        return Results.Ok(new
        {
            imei,
            date,
            total_records = results.Count,
            sample_records = results
        });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error in debug query");
        return Results.Problem($"Error: {ex.Message}");
    }
})
.WithName("DebugTime")
.WithOpenApi();

app.Run();