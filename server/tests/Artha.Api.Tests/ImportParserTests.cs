using System.Text;
using Artha.Api.Import;
using FluentAssertions;

namespace Artha.Api.Tests;

public sealed class ImportParserTests
{
    private static IReadOnlyList<RawImportRow> ParseCsv(string csv) =>
        ExpenseImportParser.Parse(new MemoryStream(Encoding.UTF8.GetBytes(csv)), "import.csv");

    [Fact]
    public void Parse_Csv_ReadsRows()
    {
        var rows = ParseCsv(
            "Date,Amount,Category,Account,Note\n" +
            "2026-05-15,12.50,Groceries,Wallet,Weekly shop\n");

        rows.Should().HaveCount(1);
        rows[0].RowNumber.Should().Be(2);
        rows[0].Date.Should().Be("2026-05-15");
        rows[0].Amount.Should().Be("12.50");
        rows[0].Category.Should().Be("Groceries");
        rows[0].Account.Should().Be("Wallet");
        rows[0].Note.Should().Be("Weekly shop");
    }

    [Fact]
    public void Parse_Csv_HonoursColumnOrderAndOptionalColumns()
    {
        var rows = ParseCsv(
            "Note,Category,Amount,Date\n" +
            "Coffee,Cafe,4.20,2026-05-16\n");

        rows.Should().HaveCount(1);
        rows[0].Date.Should().Be("2026-05-16");
        rows[0].Amount.Should().Be("4.20");
        rows[0].Category.Should().Be("Cafe");
        rows[0].Account.Should().BeNull();
        rows[0].Note.Should().Be("Coffee");
    }

    [Fact]
    public void Parse_Csv_HandlesQuotedFieldsWithCommas()
    {
        var rows = ParseCsv(
            "Date,Amount,Category,Note\n" +
            "2026-05-17,9.99,Food,\"Lunch, with tip\"\n");

        rows.Should().HaveCount(1);
        rows[0].Note.Should().Be("Lunch, with tip");
    }

    [Fact]
    public void Parse_Csv_SkipsBlankRows()
    {
        var rows = ParseCsv(
            "Date,Amount,Category\n" +
            "2026-05-15,5,Food\n" +
            "\n" +
            "2026-05-16,6,Food\n");

        rows.Should().HaveCount(2);
    }

    [Fact]
    public void Parse_Csv_MissingRequiredColumn_Throws()
    {
        var act = () => ParseCsv("Date,Category,Note\n2026-05-15,Food,x\n");

        act.Should().Throw<ImportFormatException>()
            .WithMessage("*Amount*");
    }
}
