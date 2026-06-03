namespace Artha.Api.Dtos;

public sealed record CategoryBreakdownDto(
    string CategoryId,
    string CategoryName,
    decimal Total,
    int Count);

public sealed record MonthlyReportDto(
    int Year,
    int Month,
    string Currency,
    decimal Total,
    int Count,
    decimal PlannedTotal,
    int PlannedCount,
    IReadOnlyList<CategoryBreakdownDto> ByCategory);

public sealed record MonthSummaryDto(
    int Month,
    decimal Total,
    int Count);

public sealed record YearlyReportDto(
    int Year,
    string Currency,
    decimal YearTotal,
    int YearCount,
    IReadOnlyList<MonthSummaryDto> Months,
    IReadOnlyList<CategoryBreakdownDto> ByCategory);
