namespace Artha.Api.Dtos;

public sealed record SettingsDto(
    string Currency,
    bool FirstRunCompleted,
    string? Locale);

public sealed record SettingsUpdateRequest(string Currency);

public static class SupportedCurrencies
{
    public static readonly IReadOnlyList<string> All =
        new[] { "INR", "USD", "EUR", "GBP", "JPY", "AUD", "CAD" };

    public static bool IsSupported(string code) =>
        !string.IsNullOrEmpty(code) && All.Contains(code, StringComparer.OrdinalIgnoreCase);
}
