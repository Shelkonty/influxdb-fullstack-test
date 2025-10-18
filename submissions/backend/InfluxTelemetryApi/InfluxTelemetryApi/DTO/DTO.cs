namespace InfluxTelemetryApi.DTO;

public class DTO
{
   public record DataPoint
   {
      public string? Time { get; set; }
      public object? Value { get; set; }
   }
   public record TrackPoint
   {
      public string? Time { get; set; }
      public double Lat { get; set; }
      public double Lon { get; set; }
      public long EventTime { get; set; }
   }
}