using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Artha.Api.Dtos;
using Artha.Api.Tests.Infrastructure;
using FluentAssertions;

namespace Artha.Api.Tests;

public sealed class ImportEndpointTests : IClassFixture<ArthaTestFactory>
{
    private readonly ArthaTestFactory _factory;

    public ImportEndpointTests(ArthaTestFactory factory)
    {
        _factory = factory;
    }

    private HttpClient AuthedClient(string userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.UserHeader, userId);
        return client;
    }

    private static MultipartFormDataContent CsvUpload(string csv)
    {
        var content = new ByteArrayContent(Encoding.UTF8.GetBytes(csv));
        content.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        return new MultipartFormDataContent { { content, "file", "expenses.csv" } };
    }

    [Fact]
    public async Task Preview_FlagsNewCategoriesAndInvalidRows()
    {
        var client = AuthedClient("user-import-preview");

        var response = await client.PostAsync("/api/expenses/import/preview", CsvUpload(
            "Date,Amount,Category,Account,Note\n" +
            "2026-05-15,12.50,Groceries,Wallet,Weekly shop\n" +
            "not-a-date,5,Food,,bad\n"));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var preview = await response.Content.ReadFromJsonAsync<ImportPreviewResponse>();
        preview.Should().NotBeNull();
        preview!.ValidCount.Should().Be(1);
        preview.InvalidCount.Should().Be(1);
        preview.NewCategories.Should().Contain("Groceries");
        preview.NewAccounts.Should().Contain("Wallet");
        preview.Rows.Single(r => !r.Valid).Errors.Should().NotBeEmpty();
    }

    [Fact]
    public async Task Confirm_ImportsExpensesAndAutoCreatesCategoryAndAccount()
    {
        var client = AuthedClient("user-import-confirm");

        var request = new ImportConfirmRequest(new[]
        {
            new ImportConfirmRow(new DateOnly(2026, 5, 15), 12.50m, "Groceries", "Wallet", "Weekly shop"),
            new ImportConfirmRow(new DateOnly(2026, 5, 16), 8m, "Groceries", null, "Coffee"),
        });

        var confirm = await client.PostAsJsonAsync("/api/expenses/import", request);
        confirm.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await confirm.Content.ReadFromJsonAsync<ImportResultResponse>();
        result!.ImportedCount.Should().Be(2);
        result.CreatedCategories.Should().Contain("Groceries");
        result.CreatedAccounts.Should().Contain("Wallet");

        // Expenses are persisted into the month shard.
        var list = await client.GetFromJsonAsync<ExpenseListResponse>("/api/expenses?from=2026-05&to=2026-05");
        list!.Items.Should().HaveCount(2);

        // The auto-created category and account are now listable.
        var categories = await client.GetFromJsonAsync<List<CategoryDto>>("/api/categories");
        categories!.Should().ContainSingle(c => c.Name == "Groceries");
        var accounts = await client.GetFromJsonAsync<List<AccountDto>>("/api/accounts");
        accounts!.Should().ContainSingle(a => a.Name == "Wallet");
    }

    [Fact]
    public async Task Preview_RejectsUnsupportedFileType()
    {
        var client = AuthedClient("user-import-badtype");
        var content = new ByteArrayContent(Encoding.UTF8.GetBytes("nope"));
        content.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        var form = new MultipartFormDataContent { { content, "file", "notes.txt" } };

        var response = await client.PostAsync("/api/expenses/import/preview", form);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
