using System.Net;
using System.Net.Http.Json;
using Artha.Api.Dtos;
using Artha.Api.Tests.Infrastructure;
using FluentAssertions;

namespace Artha.Api.Tests;

public sealed class ExpensesEndpointTests : IClassFixture<ArthaTestFactory>
{
    private readonly ArthaTestFactory _factory;

    public ExpensesEndpointTests(ArthaTestFactory factory)
    {
        _factory = factory;
    }

    private HttpClient AuthedClient(string userId = "user-alice")
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.UserHeader, userId);
        return client;
    }

    [Fact]
    public async Task PostThenGet_ReturnsCreatedExpense()
    {
        var client = AuthedClient("user-alice-post-get");

        var request = new ExpenseCreateRequest(
            Date: new DateOnly(2026, 5, 15),
            Amount: 12.50m,
            CategoryId: "cat-food",
            Note: "Lunch");

        var post = await client.PostAsJsonAsync("/api/expenses", request);
        post.StatusCode.Should().Be(HttpStatusCode.Created);

        var listResponse = await client.GetFromJsonAsync<ExpenseListResponse>(
            "/api/expenses?from=2026-05&to=2026-05");

        listResponse.Should().NotBeNull();
        listResponse!.Items.Should().HaveCount(1);
        listResponse.Items[0].Amount.Should().Be(12.50m);
        listResponse.Items[0].CategoryId.Should().Be("cat-food");
        listResponse.Items[0].Note.Should().Be("Lunch");
        listResponse.Currency.Should().Be("USD");
    }

    [Fact]
    public async Task Post_WithUnknownCategory_Returns400()
    {
        var client = AuthedClient("user-alice-bad-cat");

        var response = await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            Date: new DateOnly(2026, 5, 15),
            Amount: 5m,
            CategoryId: "cat-nonexistent",
            Note: null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_WithZeroAmount_Returns400()
    {
        var client = AuthedClient("user-alice-zero");

        var response = await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            Date: new DateOnly(2026, 5, 15),
            Amount: 0m,
            CategoryId: "cat-food",
            Note: null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PutThenGet_UpdatesExpense()
    {
        var client = AuthedClient("user-alice-update");

        var created = await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            new DateOnly(2026, 5, 1), 10m, "cat-food", "Original"));
        var dto = await created.Content.ReadFromJsonAsync<ExpenseDto>();
        dto.Should().NotBeNull();

        var put = await client.PutAsJsonAsync($"/api/expenses/{dto!.Id}", new ExpenseUpdateRequest(
            new DateOnly(2026, 5, 2), 25m, "cat-transport", "Updated"));
        put.StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await client.GetFromJsonAsync<ExpenseListResponse>("/api/expenses?from=2026-05&to=2026-05");
        list!.Items.Should().HaveCount(1);
        list.Items[0].Amount.Should().Be(25m);
        list.Items[0].CategoryId.Should().Be("cat-transport");
        list.Items[0].Note.Should().Be("Updated");
    }

    [Fact]
    public async Task PutAcrossMonths_MovesExpenseBetweenShards()
    {
        var client = AuthedClient("user-alice-move");

        var created = await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            new DateOnly(2026, 5, 15), 10m, "cat-food", null));
        var dto = await created.Content.ReadFromJsonAsync<ExpenseDto>();

        var put = await client.PutAsJsonAsync($"/api/expenses/{dto!.Id}", new ExpenseUpdateRequest(
            new DateOnly(2026, 6, 1), 10m, "cat-food", null));
        put.StatusCode.Should().Be(HttpStatusCode.OK);

        var may = await client.GetFromJsonAsync<ExpenseListResponse>("/api/expenses?from=2026-05&to=2026-05");
        var jun = await client.GetFromJsonAsync<ExpenseListResponse>("/api/expenses?from=2026-06&to=2026-06");

        may!.Items.Should().BeEmpty();
        jun!.Items.Should().HaveCount(1);
        jun.Items[0].Date.Should().Be(new DateOnly(2026, 6, 1));
    }

    [Fact]
    public async Task Delete_RemovesExpense()
    {
        var client = AuthedClient("user-alice-delete");

        var created = await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            new DateOnly(2026, 5, 15), 10m, "cat-food", null));
        var dto = await created.Content.ReadFromJsonAsync<ExpenseDto>();

        var delete = await client.DeleteAsync($"/api/expenses/{dto!.Id}");
        delete.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var list = await client.GetFromJsonAsync<ExpenseListResponse>("/api/expenses?from=2026-05&to=2026-05");
        list!.Items.Should().BeEmpty();
    }

    [Fact]
    public async Task Get_WithoutAuth_Returns401()
    {
        // Don't add the X-Test-User header.
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/expenses");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}

public sealed class CategoriesEndpointTests : IClassFixture<ArthaTestFactory>
{
    private readonly ArthaTestFactory _factory;
    public CategoriesEndpointTests(ArthaTestFactory factory) => _factory = factory;

    private HttpClient AuthedClient(string userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.UserHeader, userId);
        return client;
    }

    [Fact]
    public async Task Get_AfterBootstrap_ReturnsDefaultCategories()
    {
        var client = AuthedClient("user-cat-defaults");

        var categories = await client.GetFromJsonAsync<List<CategoryDto>>("/api/categories");

        categories.Should().NotBeNull();
        categories!.Should().HaveCount(6);
        categories.Select(c => c.Name)
            .Should().Contain(new[] { "Food", "Transport", "Bills", "Entertainment", "Health", "Other" });
    }

    [Fact]
    public async Task Post_AddsNewCategory()
    {
        var client = AuthedClient("user-cat-add");

        var response = await client.PostAsJsonAsync("/api/categories",
            new CategoryUpsertRequest("Hobbies", "#22d3ee", "paint-brush"));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var list = await client.GetFromJsonAsync<List<CategoryDto>>("/api/categories");
        list.Should().Contain(c => c.Name == "Hobbies");
    }

    [Fact]
    public async Task Delete_ReferencedCategory_Returns409()
    {
        var client = AuthedClient("user-cat-in-use");

        await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            new DateOnly(2026, 5, 15), 10m, "cat-food", null));

        var response = await client.DeleteAsync("/api/categories/cat-food");
        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Delete_UnreferencedCategory_SoftDeletes()
    {
        var client = AuthedClient("user-cat-archive");

        var response = await client.DeleteAsync("/api/categories/cat-bills");
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var visible = await client.GetFromJsonAsync<List<CategoryDto>>("/api/categories");
        visible.Should().NotContain(c => c.Id == "cat-bills");

        var withArchived = await client.GetFromJsonAsync<List<CategoryDto>>("/api/categories?includeArchived=true");
        withArchived.Should().Contain(c => c.Id == "cat-bills" && c.Archived);
    }
}

public sealed class SettingsEndpointTests : IClassFixture<ArthaTestFactory>
{
    private readonly ArthaTestFactory _factory;
    public SettingsEndpointTests(ArthaTestFactory factory) => _factory = factory;

    private HttpClient AuthedClient(string userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.UserHeader, userId);
        return client;
    }

    [Fact]
    public async Task Get_ReturnsDefaultCurrency_Bootstrap()
    {
        var client = AuthedClient("user-settings-default");

        var settings = await client.GetFromJsonAsync<SettingsDto>("/api/settings");

        settings.Should().NotBeNull();
        settings!.Currency.Should().Be("USD"); // TestAuthHandler emits locale "en-US".
    }

    [Fact]
    public async Task Put_ChangesCurrency()
    {
        var client = AuthedClient("user-settings-change");

        var put = await client.PutAsJsonAsync("/api/settings", new SettingsUpdateRequest("EUR"));
        put.StatusCode.Should().Be(HttpStatusCode.OK);

        var settings = await client.GetFromJsonAsync<SettingsDto>("/api/settings");
        settings!.Currency.Should().Be("EUR");
        settings.FirstRunCompleted.Should().BeTrue();
    }

    [Fact]
    public async Task Put_UnsupportedCurrency_Returns400()
    {
        var client = AuthedClient("user-settings-bad");

        var response = await client.PutAsJsonAsync("/api/settings", new SettingsUpdateRequest("XYZ"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
