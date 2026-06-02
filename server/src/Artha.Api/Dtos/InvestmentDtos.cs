namespace Artha.Api.Dtos;

public sealed record InvestmentDto(
    string Id,
    string Name,
    string Type,
    string Currency,
    decimal InvestedAmount,
    decimal CurrentValue,
    decimal? InterestRate,
    decimal? InstallmentAmount,
    DateOnly? StartDate,
    DateOnly? MaturityDate,
    string? Institution,
    string? PolicyOrAccountNumber,
    string? Note,
    string? Color,
    string? Icon,
    bool Archived);

public sealed record InvestmentUpsertRequest(
    string Name,
    string Type,
    string Currency,
    decimal InvestedAmount,
    decimal CurrentValue,
    decimal? InterestRate,
    decimal? InstallmentAmount,
    DateOnly? StartDate,
    DateOnly? MaturityDate,
    string? Institution,
    string? PolicyOrAccountNumber,
    string? Note,
    string? Color,
    string? Icon);
