using System.Globalization;
using System.Text;
using ClosedXML.Excel;

namespace Artha.Api.Import;

/// <summary>
/// A single data row read verbatim from an uploaded spreadsheet, before any
/// validation. Cell values are normalised to strings (dates -&gt; ISO, numbers
/// -&gt; invariant) so the controller can apply the same validation rules
/// regardless of whether the source was .xlsx or .csv.
/// </summary>
public sealed record RawImportRow(
    int RowNumber,
    string? Date,
    string? Amount,
    string? Category,
    string? Account,
    string? Note);

/// <summary>Thrown when a file cannot be read as a recognisable expense sheet.</summary>
public sealed class ImportFormatException(string message) : Exception(message);

/// <summary>
/// Reads expense rows from an .xlsx or .csv stream. Columns are matched by a
/// case-insensitive header row (Date, Amount, Category, Account, Note) in any
/// order; Account and Note are optional.
/// </summary>
public static class ExpenseImportParser
{
    public const int MaxRows = 5_000;

    private static readonly string[] DateAliases = ["date"];
    private static readonly string[] AmountAliases = ["amount", "amt"];
    private static readonly string[] CategoryAliases = ["category", "cat"];
    private static readonly string[] AccountAliases = ["account", "acct"];
    private static readonly string[] NoteAliases = ["note", "notes", "description", "memo"];

    public static IReadOnlyList<RawImportRow> Parse(Stream stream, string fileName)
    {
        var isCsv = fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase);
        return isCsv ? ParseCsv(stream) : ParseXlsx(stream);
    }

    private static IReadOnlyList<RawImportRow> ParseXlsx(Stream stream)
    {
        XLWorkbook workbook;
        try
        {
            workbook = new XLWorkbook(stream);
        }
        catch (Exception ex)
        {
            throw new ImportFormatException($"Could not read the Excel file. {ex.Message}");
        }

        using (workbook)
        {
            var sheet = workbook.Worksheets.FirstOrDefault()
                ?? throw new ImportFormatException("The workbook has no worksheets.");

            var rows = sheet.RowsUsed().ToList();
            var lastCol = sheet.LastColumnUsed()?.ColumnNumber() ?? 0;
            if (rows.Count == 0 || lastCol == 0)
            {
                return [];
            }

            var headerCells = new List<string>(lastCol);
            for (var c = 1; c <= lastCol; c++)
            {
                headerCells.Add(ReadCell(rows[0].Cell(c)));
            }
            var map = MapHeaders(headerCells);

            var result = new List<RawImportRow>();
            for (var i = 1; i < rows.Count; i++)
            {
                var cells = new List<string>(lastCol);
                for (var c = 1; c <= lastCol; c++)
                {
                    cells.Add(ReadCell(rows[i].Cell(c)));
                }
                if (cells.All(string.IsNullOrWhiteSpace))
                {
                    continue;
                }
                result.Add(BuildRow(result.Count + 2, map, cells));
                if (result.Count > MaxRows)
                {
                    throw new ImportFormatException($"Too many rows; the limit is {MaxRows}.");
                }
            }
            return result;
        }
    }

    private static IReadOnlyList<RawImportRow> ParseCsv(Stream stream)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var text = reader.ReadToEnd();
        var grid = CsvReader.Parse(text);
        if (grid.Count == 0)
        {
            return [];
        }

        var map = MapHeaders(grid[0]);
        var result = new List<RawImportRow>();
        for (var i = 1; i < grid.Count; i++)
        {
            var cells = grid[i];
            if (cells.All(string.IsNullOrWhiteSpace))
            {
                continue;
            }
            result.Add(BuildRow(result.Count + 2, map, cells));
            if (result.Count > MaxRows)
            {
                throw new ImportFormatException($"Too many rows; the limit is {MaxRows}.");
            }
        }
        return result;
    }

    private static RawImportRow BuildRow(int rowNumber, HeaderMap map, IReadOnlyList<string> cells)
    {
        string? At(int idx) => idx >= 0 && idx < cells.Count
            ? (string.IsNullOrWhiteSpace(cells[idx]) ? null : cells[idx].Trim())
            : null;

        return new RawImportRow(
            rowNumber,
            At(map.Date),
            At(map.Amount),
            At(map.Category),
            At(map.Account),
            At(map.Note));
    }

    private static HeaderMap MapHeaders(IReadOnlyList<string> header)
    {
        int Find(string[] aliases) => header.ToList().FindIndex(
            h => aliases.Contains(h.Trim().ToLowerInvariant()));

        var map = new HeaderMap(
            Date: Find(DateAliases),
            Amount: Find(AmountAliases),
            Category: Find(CategoryAliases),
            Account: Find(AccountAliases),
            Note: Find(NoteAliases));

        if (map.Date < 0 || map.Amount < 0 || map.Category < 0)
        {
            throw new ImportFormatException(
                "Missing required column(s). The first row must include headers: " +
                "Date, Amount, Category (and optionally Account, Note).");
        }
        return map;
    }

    private static string ReadCell(IXLCell cell)
    {
        if (cell.DataType == XLDataType.DateTime && cell.TryGetValue<DateTime>(out var dt))
        {
            return dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }
        if (cell.DataType == XLDataType.Number && cell.TryGetValue<double>(out var num))
        {
            return num.ToString(CultureInfo.InvariantCulture);
        }
        return cell.GetString();
    }

    private sealed record HeaderMap(int Date, int Amount, int Category, int Account, int Note);
}
