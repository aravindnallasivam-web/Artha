namespace Artha.Api.Dtos;

/// <summary>One parsed-and-validated row returned by the import preview.</summary>
public sealed record ImportPreviewRow(
    int RowNumber,
    DateOnly? Date,
    decimal? Amount,
    string? Category,
    string? Account,
    string? Note,
    bool Valid,
    IReadOnlyList<string> Errors);

/// <summary>
/// Result of parsing an uploaded file. Writes nothing — the client reviews
/// this, then POSTs the valid rows back to confirm.
/// </summary>
public sealed record ImportPreviewResponse(
    IReadOnlyList<ImportPreviewRow> Rows,
    int ValidCount,
    int InvalidCount,
    IReadOnlyList<string> NewCategories,
    IReadOnlyList<string> NewAccounts,
    string Currency);

/// <summary>A single expense the client confirmed for import.</summary>
public sealed record ImportConfirmRow(
    DateOnly Date,
    decimal Amount,
    string Category,
    string Account,
    string? Note);

public sealed record ImportConfirmRequest(IReadOnlyList<ImportConfirmRow> Rows);

/// <summary>Outcome of a confirmed import.</summary>
public sealed record ImportResultResponse(
    int ImportedCount,
    IReadOnlyList<string> CreatedCategories,
    IReadOnlyList<string> CreatedAccounts);
